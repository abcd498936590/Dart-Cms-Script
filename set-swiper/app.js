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
const { mixinsScriptConfig, getBjDate, dateStringify } = require('../../utils/tools')

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
let runRegFn = async (videoInfoColl, confColl, Sconfig) => {

	let maxLen = Sconfig.options.maxLen.val;
	// 强制最大20
	let limit = maxLen > 20 ? 20 : maxLen;
	//
	let body = await http('http://www.banyundog.com/11.html');
	if(!body){
		return
	}

	let imgUrlList = body.data.match(/data-fancybox="gallery"><img src="([^\s]+)" \/><\/a><\/p>/ig)
		.filter((item, index) => {
			if(index < limit){
				return true
			}
		})
		.map((item, index) => {
			return item.match(/src="([^\s]+)"/)[1];
		});

	let titleList = body.data.match(/<p style="text-align:center;"><sapn style="color:#ff0000;font-size:17px;">([^<]+)<\/span><\/p>/ig)
		.filter((item, index) => {
			if(index < limit){
				return true
			}
		})
		.map((item, index) => {
			return item.match(/<sapn style="color:#ff0000;font-size:17px;">([^<]+)<\/span>/)[1];
		});

	// 先把所有的设置成 关闭轮播图
	await videoInfoColl.updateMany({openSwiper: true}, {$set: {openSwiper: false}})
		.then((res) => {
			console.log('已全部设置关闭轮播图');
		});

	for(var i=0; i<limit; i++){
		// cursor
		let curImg = imgUrlList[i];
		let curTit = titleList[i];
		// 保险，如果，数据不正确，不更新，全部跳出
		if(!curImg || !curTit){
			break;
		}
		await videoInfoColl.findOneAndUpdate({videoTitle: curTit}, {$set: {openSwiper: true, poster: curImg, popular: true}})
			.then((res) => {
				console.log(`更新成功，标题：${curTit}，图片地址：${curTit}`);
			})
			.catch((err) => {
				console.log(`更新失败，标题：${curTit}，图片地址：${curTit}`);
			});
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
	   	let confColl = DB.collection('config');

	   	let configData = await confColl.findOne({}); //
		let isBJtime = configData.isBjTime;          //

		// 开始采集 => 配置中保存当前子进程的pid，用于手动停止
	   	// 开始采集 => 保存当前运行脚本时间
	   	// 开始采集 => 脚本状态设置为已启动
	   	mixinsScriptConfig(scriptAlias, {state: true, pid: process.pid, runTime: dateStringify(isBJtime)});

	   	await runRegFn(videoInfoColl, confColl, Sconfig);

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