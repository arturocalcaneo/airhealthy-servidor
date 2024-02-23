
const serverEnd = function(req, res){
	const date = new Date();
	const datetime = date.toLocaleString().replace(/,/g, '');

	console.log("> Cliente desconectado (",datetime,").\n");
};

const serverListen = function(p){
	console.log("> Servidor escuchando en el puerto: ", p);
};

const exception = function(req, res){
	const objeto = {
		status: 404,
		message: 'No se generó ninguna respuesta.',
		response: false
	};

	res.writeHead(404);
	res.end( JSON.stringify(objeto) );
};

module.exports = {
	exception,
	serverListen,
	serverEnd
};