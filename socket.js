const http 	= require('http');
const mUrl 	= require('url');
const IP 	= require('ip');
const fs 	= require('fs');
const requestIP	= require('request-ip');
const sqlite3	= require('sqlite3');
const { isValid, parseISO } = require('date-fns');

const funciones = require('./constantes');
const _server = require('./server');

const puerto = 4040;
var server;
var listaMedidores;

const dbroute = './db/airhealthy.db';
const table = 'mediciones';
var db;

// Definir el objeto para manejar autenticaciones de consumo
const authenticationHashes = {
    'GET': {
        '/mediciones': 'c8cfdd77ac4061a8a56f84614c23942c',
        '/mediciones/prom': '312265b9ed1e8a46e94f289921e0db4d',
        '/mediciones/prom/hoy': '2cf6f5b98a7d7b266e80d663d8756852',
        '/mediciones/prom/dia': 'dd459a4e71abe042aa74a0c34614f7d0',
        '/mediciones/prom/hora': '98c41205d51b6a99d2c5992bfa767a9a'
    },
    'POST': {
        '/medicion': '9dae27a1e26d7445e30ec3fa4b722667'
    }
};

const runApp = async function(){

	// Iniciar conexión con la base de datos
	db = new sqlite3.Database( dbroute );

	// Crear la tabla para almacenar los registros
	db.run(`
		CREATE TABLE IF NOT EXISTS ${table} (
			id INTEGER PRIMARY KEY,
			co2 INTEGER,
			temp INTEGER,
			hum INTEGER,
			ipAddress TEXT,
			macAddress TEXT,
			fechaHora TEXT
		)
	`);

	// Crear las variables para almacenar el buffer de datos y obtener el JSON del POST del cliente
	var body = '';
	var jsonBody = {};

	// Crear un nuevo servidor en el socket
	server = http.createServer(function(request, response){

		response.setHeader("Content-Type", "application/json");

		var chunks = '';
		const method = request.method;
		const url = request.url;
		const parsedUrl = mUrl.parse(url, true);

		// Aplicar metodo de autenticación excepto para la ruta /dashboard
		if( method == 'GET' && parsedUrl.pathname !== '/dashboard' && parsedUrl.pathname !== '/descargar'){
			const providedHash = (request.headers.authorization || '').split(' ')[1] || '';
		    
		    // Obtiene el hash válido para la combinación de método y endpoint
		    const validHash = authenticationHashes[method][parsedUrl.pathname];

		    if (providedHash != validHash) {
		        response.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Secure Area"' });
		        const respuesta = {
					success: false,
					status: 401,
					response: true,
					message: "Acceso Denegado. No dispones de las credenciales adecuadas."
				};

		        response.end( JSON.stringify( respuesta ) );
		        return;
		    }
		}

		console.log('> Method: ', method);
		console.log('> Url: ', url);
		console.log('> Route: ', parsedUrl.pathname);
		console.log('> ParsedUrl.Query:', parsedUrl.query, "\n" );

		switch( method ){
			case 'POST':
				request.on('data', (chunk) => {
					chunks += chunk;
					if(chunks.length > 1e6) {
		                chunks = '';
		                response.writeHead(413, {'Content-Type': 'text/plain'}).end();
		                request.connection.destroy();
		            }
				});

				request.on('end', () => {
					body = chunks;
					jsonBody = JSON.parse(body);

					// ============== REGISTRAR UNA NUEVA MEDICION ==============
					switch(parsedUrl.pathname){
						case '/medicion':
							__POST__REGISTRAR_MEDICION__(request, response, jsonBody);
						break;
						default:
								const objeto = {
									success: true,
									status: 404,
									response: false,
									message: "route not found"
								};

								response.writeHead(404);
								response.end(JSON.stringify( objeto ));
						break;
					}
					_server.serverEnd(request,response);
					// ============== REGISTRAR UNA NUEVA MEDICION ==============
				});
			break;
			case 'GET':
				// ============== OBTENER LISTA DE MEDICIONES ==============
				switch( parsedUrl.pathname ){
					case '/mediciones':
						__GET__LISTA_DE_MEDICIONES__(request, response);
					break;
					case '/mediciones/prom':
						__GET__MEDICIONES_PROMEDIADO__(request, response);
					break;
					case '/mediciones/prom/hoy':
						__GET__MEDICIONES_PROMEDIADO__(request, response, 'hoy');
					break;
					case '/mediciones/prom/dia':
						__GET__MEDICIONES_PROMEDIADO__(request, response, 'xdia', parsedUrl.query);
					break;
					case '/mediciones/prom/hora':
						__GET__MEDICIONES_PROMEDIADO__(request, response, 'xhora', parsedUrl.query);
					break;
					case '/dashboard':
						__GET__DASHBOARD__(request, response);
					break;
				case '/descargar':
					__GET__DESCARGAR__(request, response);
				break;
					default:
						const objeto = {
							success: true,
							status: 404,
							response: false,
							message: "route not found"
						};

						response.writeHead(404);
						response.end(JSON.stringify( objeto ));
					break;
				}

				_server.serverEnd(request,response);
				// ============== OBTENER LISTA DE MEDICIONES ==============
			break;
			default:
				// Buscar si desde la ruta que el cliente ha solicitado, existe en las rutas definidas.
				if( !rutas.includes(['/medicion','/mediciones']) ){
					_server.exception(request, response);
				}
			break;
		}
	});

	server.on('close', () => {
		console.log("> Cerrando la conexión con la base de datos..");
		// Cerrar Conexion con la base de datos
		db.close(err => {
		  if (err) {
		    console.error('> Error al cerrar la base de datos:', err, '\n');
		  } else {
		    console.log('> Conexión con la base de datos cerrada.\n');
		  }
		});
	});

	// Poner a escuchar el servidor en el puerto especificado.
	server.listen(puerto, () => _server.serverListen(puerto) );
};

async function __POST__REGISTRAR_MEDICION__(req, res, json) {
    try {
        const info = {};

        // Validación de datos
        if (json.co2 === undefined || isNaN(json.co2)) {
            throw new Error('El dato \'co2\' no ha sido recibido en el cuerpo de la solicitud o no es un número.');
        }

        var nivelCo2 = parseInt(json.co2);

        if(nivelCo2 < 0){
          nivelCo2 = 0;
        }

        const nivelTemperatura = parseInt(json.temp) || 0;
        const nivelHumedad = parseInt(json.hum) || 0;

        const esp32Devices = await funciones.lista_medidores();

        const ipAddress = await requestIP.getClientIp(req);
        const ipv4 = ipAddress.includes('::ffff:') ? ipAddress.split('::ffff:')[1] : ipAddress;

        console.log(" * Nivel de CO2 -> ", nivelCo2);
        console.log(" * Nivel de Temperatura -> ", nivelTemperatura);
        console.log(" * Nivel de Humedad -> ", nivelHumedad);
        console.log(" * Ipv4 Address -> " + ipv4);

        const currentDevice = esp32Devices.find(obj => obj.ip == ipv4);

        if (!currentDevice) {
            throw new Error('El dispositivo no es un microcontrolador ESP32.');
        }

        console.log(" * Mac Address -> ", currentDevice.mac);

        const db = new sqlite3.Database(dbroute);
        
        // Obtener la fecha y hora en el momento de guardar el registro en la base de datos
        const date = new Date();
        const opciones = { 
        	timeZone: 'America/Mexico_City',
        	year: 'numeric',
        	month: '2-digit',
        	day: '2-digit',
        	hour: '2-digit',
        	minute: '2-digit',
        	second: '2-digit'
        };

        const fh = date.toLocaleString('es-MX', opciones);

        // Insertar registro en la base de datos sqlite
        await new Promise((resolve, reject) => {
            db.run(`
            INSERT INTO ${table} (co2,temp,hum,ipAddress,macAddress,fechaHora) VALUES (?,?,?,?,?,?)
        `, [nivelCo2, nivelTemperatura, nivelHumedad, ipv4, currentDevice.mac, fh], function (err) {
                if (err) return reject(err);
                console.log("> Los datos han sido registrados en la base de datos. El id del registro es: '", this.lastID, "'\n");
                resolve();
            });
        });

        info.status = 200;
        info.message = 'ok';
        info.response = true;
        res.writeHead(200);
        res.end(JSON.stringify(info));

        console.log("===========================================================================================");
    } catch (error) {
        console.error("> 400 Bad Request - " + error.message);
        res.writeHead(400);
        res.end(JSON.stringify({ status: 400, message: error.message, response: false }));
    }
}

function __GET__DESCARGAR__(req, res){
	db = new sqlite3.Database( dbroute );

	db.all('SELECT * FROM mediciones', (err, rows) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Error interno del servidor');
        return;
      }
      
      // Escribe los datos en un archivo de texto
      const datosTxt = rows.map(row => `${row.id},${row.co2},${row.temp},${row.hum},${row.ipAddress},${row.macAddress},${row.fechaHora}`).join('\n');
      fs.writeFile('datos.txt', datosTxt, (err) => {
        if (err) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('Error interno del servidor');
          return;
        }
        
        // Envía el archivo como respuesta al cliente
        res.writeHead(200, {
          'Content-Type': 'text/plain',
          'Content-Disposition': 'attachment; filename=datos.txt'
        });
        const fileStream = fs.createReadStream('datos.txt');
        fileStream.pipe(res);
      });
    });
}

function __GET__LISTA_DE_MEDICIONES__(req, res){
	const info= {};

	info.status = 200;
	info.message = 'ok';
	info.response= true;
	info.data= [];

	// Abrir la base de datos
	db = new sqlite3.Database( dbroute );

	const camposAdicionales = 'DATE(fechaHora) AS func_date_fechaHora, TIME(fechaHora) AS func_time_fechaHora';

	db.all(`SELECT *, ${camposAdicionales} FROM ${table} ORDER BY id DESC`,[],
	function(err,rows){
		if( err ){
			console.error( "> Se produjo un error al consultar la tabla '",table,"': ", err.message, "\n" );

			info.status = 400;
			res.writeHead(400);

			res.end( JSON.stringify(info) );
		}else{
			// Recuperar todas las filas en la propiedad data del JSON
			info.data = rows;
			res.writeHead(200);

			res.end( JSON.stringify(info) );
		}
	});
}

function __GET__MEDICIONES_PROMEDIADO__(req, res, date = false, value = null){
	const info= {};

	info.status = 200;
	info.message = 'ok';
	info.response= true;
	info.data= [];

	// Abrir la base de datos
	db = new sqlite3.Database( dbroute );

	var _date= null;
	var fh = null;
	var f = null;

	var query= `
		SELECT 
			ROUND(AVG(co2)) AS prom_co2,
			ROUND(AVG(temp)) AS prom_temp,
			ROUND(AVG(hum)) AS prom_hum 
		FROM 
			${table} 
	`;

	if( date === 'xdia' ){
		if( value !== null ){
			if( value.fecha !== undefined ){
				if( isValid(parseISO(value.fecha)) ){
					query += `WHERE DATE(fechaHora) = '${value.fecha}'`;
				}else{
					console.error("> Error, la cadena no es una fecha válida y no cumple con el estandar ISO.");
				}
			}else{
				console.error("> Error, no se recibio el dato 'fecha'.\n");
			}
		}else{
			console.error("> Error, no se propuso una fecha específica de los registros disponibles.\n");
		}

		if(value === null && value.fecha === undefined){
			info.status = 400;

			res.writeHead(400);
			return res.end( JSON.stringify(info) );
		}
	}
	else if( date === 'hoy' ){
		_date = new Date();
		fh = _date.toISOString();
		f  = fh.slice(0,10).trim();

		query += `WHERE DATE(fechaHora) = '${f}'`;
	}
	else if( date === 'xhora' ){
		if( value !== null ){
			if( value.hora !== undefined ){
				const timeParts = value.hora.split(':');
				if( timeParts.length === 3 ){
					_date  = new Date();
					fh = _date.toISOString();
					f  = fh.slice(0,10).trim();

					query += `WHERE TIME(fechaHora) = '${value.hora}' AND DATE(fechaHora) = '${f}'`;

				}else if( timeParts.length === 2 ){
					var hora = value.hora;
						  hora = hora + ':00';

				  	_date  = new Date();
					fh = _date.toISOString();
					f  = fh.slice(0,10).trim();

					query += `WHERE TIME(fechaHora) = '${hora}' AND DATE(fechaHora) = '${f}'`;

				}else{
					console.error("> Error, el dato 'hora' no cumple con el estandar de formato.");
				}
			}else{
				console.error("> Error, no se recibio el dato 'hora'.\n");
			}
		}else{
			console.error("> Error, no se propuso una hora en específico de los registros disponibles.\n");
		}

		if(value === null && value.hora === undefined){
			info.status = 400;

			res.writeHead(400);
			return res.end( JSON.stringify(info) );
		}
	}

	db.all(
		query,
		[],
		function(err,rows){
			if( err ){
				console.error( "> Se produjo un error al consultar la tabla '",table,"': ", err.message, "\n" );

				info.status = 400;
				res.writeHead(400);

				res.end( JSON.stringify(info) );
			}else{
				// Recuperar todas las filas en la propiedad data del JSON
				info.data = rows;

				info.query= query;
				info.query= info.query.replaceAll('\t','');
				info.query= info.query.replaceAll('\n','');

				res.writeHead(200);

				res.end( JSON.stringify(info) );
			}
		}
	);
}

async function __GET__DASHBOARD__(req, res){
	try{
	    // Construimos HTML con la librería de Bootstrap
	    const bootstrapMinCss = `<style>${funciones.libreriasHTML.bootstrapMin}</style>`;
	    // Tablas con la información requerida para el Cliente
	    var TablaMediciones= await funciones.TablaMediciones(dbroute);
	    var PromMediciones= await funciones.MedPromedio(dbroute);
	    var PromMedicionesUltHora= await funciones.PromMedicionesUltHora(dbroute);
	    var PromMedicionesHoy= await funciones.PromMedicionesHoy(dbroute);
	    var PromMedicionesUlt24hrs= await funciones.PromMedicionesUlt24hrs(dbroute);
	    var PromMedicionesXdia= await funciones.PromMedicionesXdia(dbroute);
	    
	    res.setHeader("Content-Type", "text/html");
	    res.writeHead(200);
        res.end(`
        	${bootstrapMinCss}
        	<div class="container-fluid mt-4">
        		<div class="row">
        			<div class="col-sm-6">
        				${PromMediciones}
        				<br>
        				${PromMedicionesUltHora}
        				<br>
        				${PromMedicionesHoy}
        				<br>
        				${PromMedicionesUlt24hrs}
        				<br>
        			</div>
        			<div class="col-sm-6">
        				${TablaMediciones}
        			</div>
        		</div>

        		<div class="container-fluid mb-5" id="tablaPorDia">
        			${PromMedicionesXdia}
        			<div id="cuerpoDestino"></div>
        		</div>
        	</div>

        	<style>
        		@media screen and (min-width: 768px){
        			#tablaPorDia{
        				width: 60% !important;
        			}
        		}

        		@media screen and (max-width: 768px){
        			#tablaPorDia{
        				width: 100% !important;
        			}
        		}
        	</style>
    	`);
	}catch(error){
		console.log("> Error Inesperado en __GET__DASHBOARD__() ...");
		console.error(error.message);
	}
}

runApp();
