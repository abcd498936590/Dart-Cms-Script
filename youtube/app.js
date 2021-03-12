const path = require('path');
const fs = require('fs');
const fse = require('fs-extra');
const axios = require('axios');
const iconv = require('iconv-lite');
const { ObjectID } = require('mongodb');
const { MongoClass } = require('../../utils/mongo');
const Entities = require('html-entities').XmlEntities;
const to_json = require('xmljson').to_json;
const entitiesCode = new Entities();
const { mixinsScriptConfig, getBjDate, dateStringify, filterXSS } = require('../../utils/tools')

// 封装一手request方法
async function http(url){
	return new Promise((resolve, reject) => {
		setTimeout(() => {
			resolve(undefined)
		}, 15000);
		axios({
			method: 'GET',
			url: url,
			timeout: 15000,
		})
		.then(res => {
			if(res && res.status === 200){
				resolve(res)
			}else{
				resolve(undefined)
			}
		})
		.catch(err => {
			resolve(undefined)
		})
	})
	.catch(err => {
		console.log(url);
	})
}
let arrAnyResult = (arr, str) => {
	for(let arg of arr){
		// 匹配关键词
		if(new RegExp(arg).test(str)){
			return true
		}
	}
	return false
}
// 入库
let runStorageData = async (list, zyAlias, idsChannel, videoInfoColl, videoListColl, confColl, otherColl) => {
	// 拿到的当前页中的所有视频
	for(let arg of list){
		// 视频标题
		let curVideoTitle = arg.snippet.title.trim();

		// 如果开启关键词匹配
		if(idsChannel.runRegexp){
			let regList = idsChannel.regexpVal.trim().split(',');
			let anyResult = arrAnyResult(regList, curVideoTitle);
			// 关键词没有匹配到
			if(!anyResult){
				continue;
			}
		}

		// 绑定的分类
		let curChannelType = idsChannel.typeName;
		// 查找当前分类是否存在
		let curTypeFindResult = await otherColl.findOne({name: curChannelType, type: "nav_type", nav_type: "video"});
		// 如果没有找到绑定的分类
		if(!curTypeFindResult){
			continue;
		}


		// 当前视频是否已经入库
		let curVideoFindResult = await videoInfoColl.findOne({videoTitle: curVideoTitle});
		// 当前视频已经入库，跳过
		if(curVideoFindResult){
			continue;
		}


		let vid = new ObjectID();
		// 加工更新时间
		let updateTime = arg.snippet.publishTime.replace(/T|Z/ig, ' ').trim();
		// 入库视频信息
		let insertVideoInfo = {
			_id: vid,
			"videoTitle" : curVideoTitle,
		    "director" : "未知",
		    "videoImage" : arg.snippet.thumbnails.high.url,
		    "poster" : "",
		    "video_tags" : [],
		    "performer" : "",
		    "video_type" : curTypeFindResult._id,
		    "video_rate" : 0,
		    "update_time" : updateTime,
		    "language" : "未知",
		    "sub_region" : "未知",
		    "rel_time" : updateTime.substring(0, 4),
		    "introduce" : filterXSS(arg.snippet.description),
		    "remind_tip" : "youtube",
		    "news_id" : [],
		    "popular" : false,
		    "allow_reply" : false,
		    "openSwiper" : false,
		    "display" : true,
		    "scource_sort" : false
		}
		let insertVideoList = {
		    "index" : 1,
		    "name" : zyAlias,
		    "z_name" : "youtube",
		    "type" : "iframe",
		    "list" : `YouTube$https://www.youtube.com/embed/${arg.id.videoId}`,
		    "vid" : vid
		}
		let info = videoInfoColl.insertOne(insertVideoInfo);
		let list = videoListColl.insertOne(insertVideoList);
		await Promise.all([info, list])
			.then(res => {
				console.log(`入库成功，地址：https://www.youtube.com/embed/${arg.id.videoId}`);
			})
			.catch(err => {
				console.log(`入库失败，地址：https://www.youtube.com/embed/${arg.id.videoId}`);
			});
	}
}
// 获取视频
let getVideoListData = async (Sconfig, videoInfoColl, videoListColl, confColl, otherColl) => {
	// 读取域配置
	let domain = Sconfig.options.domain.val;
	let apiKey = Sconfig.options.apiKey.val;
	let idList = JSON.parse(Sconfig.options.ids.val.trim());
	let interval = Sconfig.options.interval.val;
	let interValNum = interval * 1000;
	let zyAlias = Sconfig.options.alias.val;

	for(let idsChannel of idList){
		// 如果这个分类不采集
		if(!idsChannel.runState){
			continue;
		}
		// youtube限制最多一次输出50条
		let curChannelData = await http(`${domain}?key=${apiKey}&channelId=${idsChannel.id}&part=snippet,id&order=date&maxResults=50`);
		// 如果没有或者报错捕获，说明配额使用完了
		if(!curChannelData){
			continue;
		}
		curChannelData = curChannelData.data;
		let curIdhannelPageInfo = curChannelData.pageInfo;
		// 算下分页
		let maxPage = Math.ceil(curIdhannelPageInfo.totalResults / curIdhannelPageInfo.resultsPerPage);
		// 存下一页token
		let nextPageToken = curChannelData.nextPageToken;

		// 先存下第一页的
		await runStorageData(curChannelData.items, zyAlias, idsChannel, videoInfoColl, videoListColl, confColl, otherColl);

		if(maxPage < 2){
			continue;
		}

		for(let i=1; i<maxPage; i++){
			let curPageResult = await http(`${domain}?key=${apiKey}&channelId=${idsChannel.id}&part=snippet,id&order=date&maxResults=50&pageToken=${nextPageToken}`);
			// 如果没有跳出
			if(!curPageResult){
				continue;
			}
			curPageResult = curPageResult.data;
			nextPageToken = curPageResult.nextPageToken;
			// 开始存储
			await runStorageData(curPageResult.items, zyAlias, idsChannel, videoInfoColl, videoListColl, confColl, otherColl);
			// 采集间隔
			await new Promise((resolve, reject) => {
				setTimeout(() => {
					return resolve();
				}, interValNum);
			})
		}
	}
}
// 导出
let mainFn = async (DB) => {
	// 如果正在运行，直接退出，确保安全
	let curConfPath = path.resolve(__dirname, './config.json');
	let runConf = fse.readJsonSync(curConfPath);
	let scriptAlias = runConf.alias;
	if(runConf.state){
		process.exit();
	}
	// 箭头函数 与 promise = 狗币
	return new Promise(async (resolve, reject) => {

		let Sconfig = runConf;

	   	let timeout = Sconfig.timeout * 60000;
	   	// 最大采集时间
	   	setTimeout(() => {
	   		reject();
	   	}, timeout);
	   	// 正常
	   	let videoInfoColl = DB.collection('video_info');
	   	let videoListColl = DB.collection('video_list');
	   	let otherColl = DB.collection('other');
	   	let confColl = DB.collection('config');

	   	let configData = await confColl.findOne({}); //
		let isBJtime = configData.isBjTime;          //

		// 开始采集 => 配置中保存当前子进程的pid，用于手动停止
	   	// 开始采集 => 保存当前运行脚本时间
	   	// 开始采集 => 脚本状态设置为已启动
	   	mixinsScriptConfig(scriptAlias, {state: true, pid: process.pid, runTime: dateStringify(isBJtime)});

	   	// 运行采集函数
	   	console.log('采集开始！');
	   	await getVideoListData(Sconfig, videoInfoColl, videoListColl, confColl, otherColl);
	   	console.log('采集完成！');

		resolve();
	}).then(res => {
		// 把采集状态 改成 停止
		mixinsScriptConfig(scriptAlias, {state: false});
		// 停止
		process.exit();
	}).catch(err => {
		console.log(err);
		// 把采集状态 改成 停止
		mixinsScriptConfig(scriptAlias, {state: false});
		// 停止
		process.exit();
	})
}
// mainFn();
MongoClass(mainFn)