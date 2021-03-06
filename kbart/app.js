const path = require('path');
const fse = require('fs-extra');
const axios = require('axios');
const iconv = require('iconv-lite');
const { ObjectID } = require('mongodb');
const { MongoClass } = require('../../utils/mongo');
const Entities = require('html-entities').XmlEntities;
const to_json = require('xmljson').to_json;
const entitiesCode = new Entities();
const { mixinsScriptConfig, getBjDate, dateStringify, filterXSS } = require('../../utils/tools')


let sTypeGroup = {};   // 绑定的分类
let interval = 0;      // 间隔时间

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
// 获取源
// 每一条数据
let getCurArtData = async (artItem, Sconf, articleInfo, articleList, configData, otherColl) => {
	// 资源网尼玛各种空格
	let curATypeKey = artItem.type_name.trim();
	// 先判断当前视频所在的分类是否绑定了，未绑定，直接略过，绑定则查看绑定的分类是否正确
	let isBindType = (sTypeGroup[curATypeKey]).trim();
	// 不存在 => 未绑定，存在不是字符串，存在，是字符串，但是id长度不符合要求
	if(!isBindType || typeof isBindType !== 'string' || typeof isBindType === 'string' && isBindType.length !== 24){
		return
	}

	// 存在，长度符合要求，再次查看该id分类是否在表中，不在略过
	// 注意这里，查询条件，如果是视频 + nav_type: "video" ，如果是文章 + nav_type: "article"
	let existType = await otherColl.findOne({_id: new ObjectID(isBindType), type: "nav_type", nav_type: "article"});
	// 绑定的分类，已经不存在表中（被删除），那么也略过本条
	if(!existType){
		return
	}

	// 找到数据
	let isExist = await articleInfo.findOne({articleTitle: artItem.art_name.trim()});

	// 如果有，过
	if(isExist){
		return
	}


	let bool = true;

	while(bool){

		// 没有则拉接口获取文章内容
		let httpResult = await http(`${Sconf.options.domain.val}?ac=detail&ids=${artItem.art_id}`);

		let isAllow = httpResult && httpResult.data.code == 1 ? httpResult.data.list : false;

		// 如果内容没有不符合
		if(!isAllow){
			console.log(`详情页无内容，地址：${Sconf.options.domain.val}?ac=detail&ids=${artItem.art_id}`);
			continue;
		}else{

			let art_con = isAllow[0];

			let aid = new ObjectID();

			let p1 = articleInfo.insertOne({
				"_id" : aid,
				"articleTitle" : artItem.art_name.trim(),
			    "articleImage" : artItem.art_pic,
			    "poster" : "",
			    "article_type" : existType._id,
			    "introduce" : art_con.art_blurb,
			    "update_time" : art_con.art_time,
			    "video_id" : [],
			    "popular" : false,
			    "allow_reply" : false,
			    "openSwiper" : false,
			    "display" : true
			});
			let p2 = articleList.insertOne({
				"aid" : aid,
				"text" : art_con.art_content
			})
			await Promise.all([p1, p2]);

			break;
		}
	}

}
let getArtListData = async (filterBindTypeList, Sconf, articleInfo, articleList, configData, otherColl) => {
	// 采集间隔时间（秒）
	let interValNum = interval * 1000;

	for(let typeItem of filterBindTypeList){

		let maxPageLen = 2;

		page:

		for(var i=1; i<=maxPageLen; i++){

			let bool = true;
			let once = false;

			while(bool){

				let body = await http(`${Sconf.options.domain.val}?ac=list&t=${typeItem.typeId}&pg=${i}&h=${Sconf.options.h.val}`);
				// 采集频率 - 文章不同，需要再次请求详情，所以采集间隔要换位置
				await new Promise((resolve, reject) => {
					setTimeout(() => {
						return resolve();
					}, interValNum);
				})
				if(!body){
					console.log(`列表页无内容，地址：${Sconf.options.domain.val}?ac=list&t=${typeItem.typeId}&pg=${i}&h=${Sconf.options.h.val}`);
					continue;
				}
				// 第一次，得总页数和运行第一次结果，二合一
				if(i === 1 && !once){
				   	let numMax = Number(body.data.pagecount);
				   	// 如果当前分类没有内容，直接跳过
				   	if(!numMax){
				   		break page;
				   	}
					maxPageLen = numMax;
					once = true;
				}
				let list = await new Promise((res, rej)=>{
					try{
				   		if(body.data.code == 1){
				   			return res(body.data.list);
				   		}
				   		return res(false);
					}catch(err){
						res(false)
					}
			   	});

			   	// 是否页面又错误输出，无法解析
			   	if(!list){
			   		continue;
			   	}

				for(let [index, item] of list.entries()){
					await getCurArtData(item, Sconf, articleInfo, articleList, configData, otherColl);
					console.log(`第 ${i} 页，共 ${maxPageLen} 页，第 ${index+1} 条，名称： ${item.art_name.trim()}`);
					// 采集频率 - 文章详情里面还有一次请求，所以这里还需要加入采集间隔
					await new Promise((resolve, reject) => {
						setTimeout(() => {
							return resolve();
						}, interValNum);
					})
				}
				break;
			}
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

	   	let confColl = DB.collection('config');

	   	let configData = await confColl.findOne({}); //
		let isBJtime = configData.isBjTime;          //

	   	// 开始采集 => 配置中保存当前子进程的pid，用于手动停止
	   	// 开始采集 => 保存当前运行脚本时间
	   	// 开始采集 => 脚本状态设置为已启动
	   	mixinsScriptConfig(scriptAlias, {state: true, pid: process.pid, runTime: dateStringify(isBJtime)});

		let Sconf = runConf;
	   	let timeout = Sconf.timeout * 60000;
	   	// 最大采集时间
	   	setTimeout(() => {
	   		reject();
	   	}, timeout);
	   	// 正常
	   	let articleInfo = DB.collection('article_info');
	   	let articleList = DB.collection('article_list');
	   	let otherColl = DB.collection('other');

	   	// 存配置
	   	interval = Sconf.options.interval.val;

	   	// 筛选 已经绑定分类的
	   	let filterBindTypeList = Sconf.options.bindType.list.filter((item) => {
	   		if(typeof item.bindId === "string" && item.bindId.length === 24){
	   			let objKey = item.name;
	   			sTypeGroup[objKey] = item.bindId;
	   			return true
	   		}
	   	})

	   	console.log('采集开始！');
	   	await getArtListData(filterBindTypeList, Sconf, articleInfo, articleList, configData, otherColl);
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