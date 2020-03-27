var axios = require('axios');
var exec = require('child_process').exec;
var fs = require('fs');
var path = require('path');
var execFile = require('child_process').execFile;
const request = require('request');
const http = require('http');
const ProgressBar = require('progress')
const moment = require("moment");

let completed = 0;
let tickTime = '';

async function start() {
	await getAudioUrls();
}

start();

async function getAudioUrls() {
    const rl = require('readline').createInterface(process.stdin,process.stdout);
    console.log('输入专辑地址!');
    rl.on('line', async function(url){
		console.log("资源地址获取中...");
		var parts = url.split('/');
		var albumId = parts[4];
		var albumUrl = 'https://www.ximalaya.com/revision/album?albumId=' + albumId;
			
		let albumInfo = await axios.get(albumUrl);
		let albumName = albumInfo.data.data.mainInfo.albumTitle.replace('|', '').replace(' ', '');
		let trackCounts = albumInfo.data.data.tracksInfo.trackTotalCount;
		let pageSize = albumInfo.data.data.tracksInfo.pageSize;
		let pages = Math.ceil(trackCounts / pageSize);
		let trackListUrls = [];
		for (var i = 1; i <= pages; i++) {
			trackListUrls.push('https://www.ximalaya.com/revision/album/v1/getTracksList?albumId=' + albumId + '&pageNum=' + i);
		}
		let promiseRquests = [];
		let audioUrls = [];
		for (var i = 0; i < trackListUrls.length; i++) {
			let trackPageInfo = await axios.get(trackListUrls[i])
			for (var k = 0; k < trackPageInfo.data.data.tracks.length; k++) {
				let track = trackPageInfo.data.data.tracks[k];
				var trackUrl = 'https://www.ximalaya.com/revision/play/v1/audio?id=' + track.trackId + '&ptype=1';
				var trackInfo = await axios.get(trackUrl);
				if (trackInfo.data.data.src != undefined &&
					trackInfo.data.data.src != null && 
					trackInfo.data.data.src.trim() !== '') 
				{
					audioUrls.push({
					albumName: albumName,
					trackName: track.title,
					trackSrc: trackInfo.data.data.src
				})
				}
			}
		}
		console.log("成功获取到" + audioUrls.length + "条记录");
		if (audioUrls.length == 0) {
			process.exit(0);
		}
		completed = 0;
		let dir = './';
		let albumDir = dir + albumName + '/';
		let makeDirStatus = false;
		fs.access(albumDir, async function (accessErr) {
			if (accessErr) {
				fs.mkdir(albumDir, async function (makeDirErr) {
					if (!makeDirErr) {
						console.log("目录" + albumDir + "创建成功");
						console.log("准备资源下载");
						for (t = 0; t < audioUrls.length; t++) {
							await downloadFile(audioUrls[t], albumDir, 0, t+1, audioUrls.length);
						};
					} else {
						console.log("目录" + albumDir + "创建失败");
						process.exit(0);
					}
				})
			} else {
				console.log("目录" + albumDir + "创建成功");
				console.log("准备资源下载");
				for (t = 0; t < audioUrls.length; t++) {
					await downloadFile(audioUrls[t], albumDir, 0, t+1, audioUrls.length);
				}
			}
		})
    });
	rl.on('close', function() {
		console.log('操作完成');
		process.exit(0);
	});
}

async function downloadFile (mediaUrl, albumDir, redo, current, count) {
  var url = mediaUrl.trackSrc;
  var trackName = mediaUrl.trackName.replace("|", "").replace(" ", "");
  const { data, headers } = await axios({
	url,
	method: 'GET',
	responseType: 'stream'
  })
  const totalLength = headers['content-length']

  const progressBar = new ProgressBar('-> ' + current + "/" + count + " | " + trackName + ' [:bar] :percent', {
	  width: 40,
	  complete: '=',
	  incomplete: ' ',
	  renderThrottle: 1,
	  total: parseInt(totalLength)
	})

  const writer = await fs.createWriteStream(
	path.resolve(__dirname, mediaUrl.albumName, trackName + '.m4a')
  )

  data.on('data', (chunk) => {
	  progressBar.tick(chunk.length);  //将切片长度作为步长
	  if (tickTime == '') {
		tickTime = moment().format("YYYY-MM-DD hh:mm:ss");
	  } else {
		seconds = moment().diff(moment(tickTime, "YYYY-MM-DD hh:mm:ss"),"seconds");
		if (seconds > 5) {
			// console.log('超时退出');
			// process.exit(0);
		}
		tickTime = moment().format("YYYY-MM-DD hh:mm:ss");
	  }
	  if (progressBar.complete) {
		  completed++;
	  }
	  if (completed == count) {
		console.log('下载完成');
		process.exit(0);
	  }
  })
  data.pipe(writer);
}

function getHttpReqCallback(mediaUrl, albumName, dir, redo) {
	var albumDir = dir + albumName + '/';
	var path = albumDir + mediaUrl.trackName + '.m4a';

	var callback = function (res) {
		console.log("request: " + mediaUrl.src + " return status: " + res.statusCode);
		var contentLength = parseInt(res.headers['content-length']);
		var fileBuff = [];
		res.on('data', function (chunk) {
			var buffer = new Buffer(chunk);
			fileBuff.push(buffer);
		});
		res.on('end', function () {
			console.log("end downloading " + mediaUrl.trackName);
			if (isNaN(contentLength)) {
				console.log(mediaUrl.trackName + " content length error");
				return;
			}
			var totalBuff = Buffer.concat(fileBuff);
			console.log("totalBuff.length = " + totalBuff.length + " " + "contentLength = " + contentLength);
			if (totalBuff.length < contentLength) {
				if (redo < 3) {
					console.log(mediaUrl.trackName + " download error, try again");
					startDownloadTask(mediaUrl, albumName, dir, redo++);
				}
				return;
			}
			fs.appendFile(path, totalBuff, function (err) {});
		});
	};

	return callback;
}

var startDownloadTask = function (mediaUrl, albumName, dir, redo) {
	fs.access(dir + albumName + '/', function (err) {
		// 如果目录不存在
		if (err) {
			fs.mkdir(dir + albumName + '/', function (err) {
				if (!err) {
					console.log("开始下载 " + mediaUrl.trackName);
					var req = http.request(mediaUrl.src, getHttpReqCallback(mediaUrl, albumName, dir, redo));
					req.on('error', function (e) {
						console.log(mediaUrl.trackName + " 下载失败" + e);
						if (redo < 3) {
							console.log(mediaUrl.trackName + ' 重新下载');
							startDownloadTask(mediaUrl, albumName, dir, redo++);
						}
					});
					req.on('end', function (e) {
						console.log(mediaUrl.trackName + ' 下载成功');
					});
					req.end();
				} else {
					//console.log(err);
				}
			})
		} else {
			console.log("开始下载 " + mediaUrl.trackName);
			var req = http.request(mediaUrl.src, getHttpReqCallback(mediaUrl, albumName, dir, redo));
			req.on('error', function (e) {
				console.log(mediaUrl.trackName + " 下载失败" + e);
				if (redo < 3) {
					console.log(mediaUrl.trackName + ' 重新下载');
					startDownloadTask(mediaUrl, albumName, dir, redo++);
				}
			});
			req.on('end', function (e) {
				console.log(mediaUrl.trackName + ' 下载成功');
			});
			req.end();
		}
	})
}

