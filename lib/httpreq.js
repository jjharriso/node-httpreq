/*
Copyright (c) 2013 Sam Decrock <sam.decrock@gmail.com>

MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

var querystring = require('querystring');
var https = require('https');
var http = require('http');
var url = require('url');
var fs = require('fs');

exports.get = function(url, options, callback){
	// if only 2 args are provided
	if(callback === undefined && options && typeof(options)==="function")
		callback = options;

	var moreOptions = options;
	moreOptions.url = url;
	moreOptions.method = 'GET';

	if(moreOptions.allowRedirects === undefined)
		moreOptions.allowRedirects = true;

	doRequest(moreOptions, callback);
}

exports.post = function(url, options, callback){
	// if only 2 args are provided
	if(callback === undefined && options && typeof(options)==="function")
		callback = options;

	var moreOptions = options;
	moreOptions.url = url;
	moreOptions.method = 'POST';
	doRequest(moreOptions, callback);
}

exports.put = function(url, options, callback){
	// if only 2 args are provided
	if(callback === undefined && options && typeof(options)==="function")
		callback = options;

	var moreOptions = options;
	moreOptions.url = url;
	moreOptions.method = 'PUT';
	doRequest(moreOptions, callback);
}

exports.delete = function(url, options, callback){
	// if only 2 args are provided
	if(callback === undefined && options && typeof(options)==="function")
		callback = options;

	var moreOptions = options;
	moreOptions.url = url;
	moreOptions.method = 'DELETE';
	doRequest(moreOptions, callback);
}

exports.download = function (url, downloadlocation, progressCallback, callback) {
	var options = {};
	options.url = url;
	options.method = 'GET';
	options.downloadlocation = downloadlocation;
	options.allowRedirects = true;

	// if only 3 args are provided, so no progressCallback
	if(callback === undefined && progressCallback && typeof(progressCallback)==="function")
		callback = progressCallback;
	else
		options.progressCallback = progressCallback;

	doRequest(options, callback);
}

// old function, can still be used:
exports.uploadFiles = function(options, callback){
	var moreOptions = options;
	moreOptions.method = 'POST';
	doRequest(moreOptions, callback);
}


function doRequest(o, callback){
	if(!callback) callback = function (err) {}; // dummy function

	// prevent multiple callbacks
	var finalCallbackDone = false;
	function finalCallback(err, res) {
		if(!finalCallbackDone) {
			finalCallbackDone = true;
			callback(err, res);
		}
	}

	if(o.maxRedirects === undefined){
		o.maxRedirects = 10;
	}

	var chunks = [];
	var body; // Buffer
	var contentType;

	var port;
	var host;
	var path;
	var isHttps = false;

	if(o.proxy){
		port = o.proxy.port;
		host = o.proxy.host;
		path = o.url; // complete url
		if(o.proxy.protocol && o.proxy.protocol.match(/https/)) isHttps = true;
	}else{
		var reqUrl = url.parse(o.url);
		host = reqUrl.hostname;
		path = reqUrl.path;
		if(reqUrl.protocol == 'https:') isHttps = true;
		if(reqUrl.port){
			port = reqUrl.port;
		}else if(isHttps){
			port = 443;
		}else{
			port = 80;
		}
	}

	if(o.files && o.files.length > 0 && o.method == 'GET'){
		var err = new Error("Can't send files using GET");
		err.code = 'CANT_SEND_FILES_USING_GET';
		return finalCallback(err);
	}

	if(o.parameters){
		if(o.method == 'GET'){
			path += "?" + querystring.stringify(o.parameters);
		}else{
			body = new Buffer( querystring.stringify(o.parameters), 'utf8' );
			contentType = 'application/x-www-form-urlencoded; charset=UTF-8';
		}
	}

	if(o.json){
		body = new Buffer( JSON.stringify(o.json), 'utf8' );
		contentType = 'application/json';
	}

	if(o.files){
		var crlf = "\r\n";
		var boundary = generateBoundary();
		var separator = '--' + boundary;
		var bodyArray = new Array(); // temporary body array

		// if the user wants to POST/PUT files, other parameters need to be encoded using 'Content-Disposition'
		for(var key in o.parameters){
			var encodedParameter = separator + crlf
				+ 'Content-Disposition: form-data; name="'+encodeURIComponent(key)+'"' + crlf
				+ crlf
				+ o.parameters[key] + crlf;
			bodyArray.push(new Buffer(encodedParameter));
		}

		// now for the files:
		var haveAlreadyAddedAFile = false;

		for(var file in o.files){
			var filepath = o.files[file];
			var filename = filepath.replace(/\\/g,'/').replace( /.*\//, '' );

			var encodedFile = separator + crlf
				+ 'Content-Disposition: form-data; name="' + file + '"; filename="' + filename + '"' + crlf
				+ 'Content-Type: application/octet-stream' +  crlf
				+ crlf;

			// add crlf before separator if we have already added a file
			if(haveAlreadyAddedAFile)
				encodedFile = crlf + encodedFile;

			bodyArray.push(new Buffer(encodedFile));

			// add binary file:
			bodyArray.push(require("fs").readFileSync(filepath));

			haveAlreadyAddedAFile = true;
		}

		var footer = crlf + separator + '--' + crlf;
		bodyArray.push(new Buffer(footer));

		// set body and contentType:
		body = Buffer.concat(bodyArray);
		contentType = 'multipart/form-data; boundary=' + boundary;
	}

	// overwrites the body if the user passes a body:
	// clears the content-type
	if(o.body){
		body = new Buffer( o.body, 'utf8' );
		contentType = null;
	}


	var requestoptions = {
		host: host,
		port: port,
		path: path,
		method: o.method,
		headers: {}
	};

	if(!o.redirectCount){
		o.redirectCount = 0;
	}

	if(body){
		requestoptions['headers']['Content-Length'] = body.length;
	}

	if(contentType){
		requestoptions['headers']['Content-Type'] = contentType;
	}

	if(o.cookies){
		requestoptions['headers']['Cookie'] = o.cookies.join("; ");
	}

	if(o.rejectUnauthorized !== undefined && isHttps){
		requestoptions.rejectUnauthorized = o.rejectUnauthorized;
	}

	if(isHttps && o.key){
		requestoptions.key = o.key;
	}

	if(isHttps && o.cert){
		requestoptions.cert = o.cert;
	}

	if(isHttps && o.secureProtocol) {
		requestoptions.secureProtocol = o.secureProtocol;
	}
	
	if(isHttps && o.ciphers) {
		requestoptions.ciphers = o.ciphers;
	}

	if(isHttps && o.passphrase ) {
		requestoptions.passphrase  = o.passphrase ;
	}

	if(isHttps && o.pfx) {
		requestoptions.pfx = o.pfx;
	}

	if(isHttps && o.ca) {
		requestoptions.ca = o.ca;
	}

	// add custom headers:
	if(o.headers){
		for(var headerkey in o.headers){
			requestoptions['headers'][headerkey] = o.headers[headerkey];
		}
	}

	if(o.agent){
		requestoptions.agent = o.agent;
	}

	if(o.auth){
		requestoptions.auth = o.auth;
	}

	if(o.localAddress){
		requestoptions.localAddress = o.localAddress;
	}

	if(o.secureOptions){
		requestoptions.secureOptions = o.secureOptions;
	}

	function requestResponse(res){
		var ended = false;
		var currentsize = 0;

		var downloadstream = null;
		if(o.downloadlocation)
			downloadstream = fs.createWriteStream(o.downloadlocation);

		res.on('data', function (chunk) {
			if(o.downloadlocation)
				downloadstream.write(chunk); //write it to disk, not to memory
			else
				chunks.push(chunk);

			if(o.progressCallback){
				var totalsize = res.headers['content-length'];
				if(totalsize){
					currentsize += chunk.length;

					o.progressCallback(null, {
						totalsize: totalsize,
						currentsize: currentsize,
						percentage: currentsize*100/totalsize
					});
				}else{
					o.progressCallback(new Error("no content-length specified for file, so no progress monitoring possible"));
				}

			}
		});

		res.on('end', function (err) {
			ended = true;

			// check for redirects
			if(res.headers.location && o.allowRedirects){
				if(o.redirectCount < o.maxRedirects){
					o.redirectCount++;
					o.url = res.headers.location;
					o.cookies = extractCookies(res.headers);
					return doRequest(o, finalCallback);
				} else {
					var err = new Error("Too many redirects (> " + o.maxRedirects + ")");
					err.code = 'TOOMANYREDIRECTS';
					err.redirects = o.maxRedirects;
					return finalCallback(err);
				}
			}

			if(!o.downloadlocation){
				var responsebody = Buffer.concat(chunks);
				if(!o.binary)
					responsebody = responsebody.toString('utf8');

				finalCallback(null, {headers: res.headers, statusCode: res.statusCode, body: responsebody, cookies: extractCookies(res.headers)});
			}else{
				downloadstream.end(null, null, function () {
					finalCallback(null, {headers: res.headers, statusCode: res.statusCode, downloadlocation: o.downloadlocation, cookies: extractCookies(res.headers)});
				});
			}
		});

		res.on('close', function () {
			if(!ended)
				finalCallback(new Error("Request aborted"));
		});
	}

	var request;

	// remove headers with undefined keys or values
	// else we get an error in Node 0.12.0 about "setHeader()"
	for(var headerName in requestoptions.headers){
		var headerValue = requestoptions.headers[headerName];
		if(!headerName || !headerValue){
			delete requestoptions.headers[headerName];
		}
	}

	if(isHttps)
		request = https.request(requestoptions, requestResponse);
	else
		request = http.request(requestoptions, requestResponse);

	if(o.timeout){
		request.on('socket', function(socket){
			socket.on('timeout', function() {
				var err = new Error('request timed out');
				err.code = 'TIMEOUT';
				finalCallback(err);
				request.abort();
			});
			socket.setTimeout(parseInt (o.timeout, 10));
		});
	}

	request.on('error', function (err) {
		finalCallback(err);
	});

	if(body)
		request.write(body);


	request.end();
};


function generateBoundary() {
    var boundary = '---------------------------';
    var charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

    for(var i=0; i < 29; i++)
        boundary += charset.charAt(Math.floor(Math.random() * charset.length));

    return boundary;
}

function extractCookies (headers) {
	var rawcookies = headers['set-cookie'];

	if(!rawcookies) return [];
	if(rawcookies == []) return [];

	var cookies = [];
	for (var i = 0; i < rawcookies.length; i++) {
		var rawcookie = rawcookies[i].split(';');
		if(rawcookie[0]) cookies.push(rawcookie[0]);
	};
	return cookies;
}

exports.doRequest = doRequest;

