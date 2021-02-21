# 其他开源项目

* [Dart-CMS](https://github.com/abcd498936590/Dart-Cms)  =>> Dart-Cms完整项目
* [Dart-Cms-Manage](https://github.com/abcd498936590/Dart-Cms-Manage)   =>> Dart-Cms后台管理系统页面部分
* [Dart-Cms-Flutter](https://github.com/abcd498936590/Dart-Cms-Flutter)  =>> Dart-Cms的安卓客户端，使用flutter开发
* [flutter fijkplayer](https://github.com/abcd498936590/fijkplayer_skin)  =>> Flutter fijkplayer的一款皮肤


## Dart-Cms插件

1：如何使用插件？

将插件目录压缩成 zip 格式，点击 Dart-Cms 后台管理系统中的上传插件按钮，将插件上传到管理系统中。就可以正常使用
我所上传的插件不一定都可以使用，有的采集接口可能会定期更换，或者网络原因，不能访问，或者经常访问超时，dns污染等等

2：插件如何开发？

在开发插件之前，首先要知道当前 cms 的数据库、以及数据表的结构，以及插件实例。

3：插件有哪几部分组成？

一个插件由一个目录，一个app.js，一个config.json组成。

## 数据库mongodb数据库中 cms 使用 movie 数据库，数据表依次是

```
	article_info  => 文章结构数据表

	article_list  => 文章正文数据表

	config        => cms 配置单独存一个数据表

	logs          => cms 登录日志数据表

	message       => cms 留言回复数据库

	other         => 杂项数据表，存储导航，分类，等

	session1      => cookie <=> session 持久化到这里

	session2      => token <=> session 持久化到这里

	user          => cms 用户数据表

	video_info    => 视频结构数据表

	video_list    => 视频播放源数据表

```

## config.json字段解答

```
{
	"file": "app.js",                         // 插件的主文件，这里不支持修改，一定执行app.js
	"name": "壹贰叁资源网",                   // 插件中文名称，支持在Cms后台修改
	"note": "采集接口速度比较快，推荐采集。", // 插件的备注说明
	"alias": "123zy",                         // 别名，也是插件所在目录的名称，必须一致
	"state": false,                           // 插件当前的状态，运行中true，空闲false
	"timeout": 7200000,                       // 插件最大运行时间，防止插件运行卡住，超时自动停止
	"pid": 0,                                 // pid记录的是当前插件所在的进程的id，用来手动停止插件
	"runTime": "",                            // 记录插件运行时的时间，序列化字符串，例：2020-01-01 12:01:01
	"options": {                              // 附加参数，更加灵活，配合后台灵活修改参数
		"h": {                                // 附加参数的 key，
			"key": "采集周期",                // 附加参数的 key 的中文名称
			"type": "number",                 // 附加参数的 key 的 value 的类型
			"val": 0                          // 附加参数的 key 的 value
		},
		"domain": {                           // 以此类推 附加参数key，域
			"key": "采集接口",
			"type": "string",
			"val": "http://cj.123ku2.com:12315/inc/api.php"
		}
	}
}

```

## Cms中已经开放给你的工具函数有哪些？

这里举例来说，以下是一个插件的示例代码：

```
const path = require('path');
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
		}, 3000);
		axios({
			method: 'GET',
			url: url,
			timeout: 3000,
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
// 导出
let mainFn = async (DB) => {
	// 如果正在运行，直接退出，确保安全
	let curConfPath = path.resolve(__dirname, './config.json');
	let runConf = fse.readJsonSync(curConfPath);
	if(runConf.state){
		process.exit();
	}
	// 箭头函数 与 promise = 狗币
	return new Promise(async (resolve, reject) => {

		// 开始采集 => 配置中保存当前子进程的pid，用于手动停止
	   	// 开始采集 => 保存当前运行脚本时间
	   	// 开始采集 => 脚本状态设置为已启动
	   	mixinsScriptConfig('123zy', {state: true, pid: process.pid, runTime: dateStringify(isBJtime)});

		let config = runConf;
		// 采集源 首页
		let httpResult = await http(`${config.options.domain.val}?ac=videolist&h=${config.options.h.val}`).catch(err => {
	   		reject(new Error('发生错误，位置：首页'))
	   	});
	   	// 获取总页码
	   	if(!httpResult){
	   		return reject()
	   	}
	   	httpResult = await new Promise((res, rej)=>{
	   		to_json(httpResult.data, function (error, data){
	   			if(error){
	   				return rej()
	   			}
	   			// 正常
	   			res(data.rss.list.$);
	   		})
	   	}).catch(()=>{
	   		process.exit();
	   	})
	   	// 最大采集时间
	   	setTimeout(() => {
	   		reject();
	   	}, config.timeout);
	   	// 正常
	   	let videoInfoColl = DB.collection('video_info');
	   	let videoListColl = DB.collection('video_list');
	   	let otherColl = DB.collection('other');
	   	let confColl = DB.collection('config');

	   	let configData = await confColl.findOne({}); //
		let isBJtime = configData.isBjTime;          //

	   	let maxPage = Number(httpResult.pagecount);

	   	await 你的函数(maxPage, config, videoInfoColl, videoListColl, confColl, otherColl);
	   	console.log('采集完成！');

		resolve();
	}).then(res => {
		// 把采集状态 改成 停止
		mixinsScriptConfig('123zy', {state: false});
		// 停止
		process.exit();
	}).catch(err => {
		console.log(err);
		// 把采集状态 改成 停止
		mixinsScriptConfig('123zy', {state: false});
		// 停止
		process.exit();
	})
}
MongoClass(mainFn)
```

## 这里解释一下插件引入了哪些方法和库
```
fs-extra => 是第三方nodejs fs模块的promise版本，完美兼容fs模块
path => 官方模块，路径相关
axios => 发送http请求，request库官方已经停止维护，建议使用axios
iconv => 用于编码转义，如果你写一些网页爬虫，可能会用到这个
mongodb => 官方nodejs版本mongodb-native
MongoClass => 我个人写的一个函数，用于连接mongodb，注：nodejs主进程和子进程不会共享连接池
html-entities => 用于将unicode码转成utf-8汉字
xmljson => xml转json
```

## cms自带的本地的tools文件夹中的方法
```
encryption => 用于加密密码，简单加密md5+hash
createTokenID => tokenID生成，hex hash
makeArrObjectID => 将mongodb _id字符串批量new成对象ObjectID
findUserID => 从一个数组中查找一个_id是否存在
getBjDate => 获取北京时间
mixinsScriptConfig => 修改当前脚本的配置文件
dateStringify => 生成时间序列字符串
dirCatImgs => 遍历目录下的图片，jpg，png，gif
placeUploadImg => 将图片数据流生成图片，并且存放到指定目录
```

## 插件几个必要的函数

mainFn函数，是一个封装的运行函数，里面的内容包括，发送http请求，在成功或者失败的时候修改当前插件的config文件
MongoClass(mainFn)，这个函数是在mongodb连接成功时候的回调函数，连接成功时候调用maninFn函数，开始执行脚本的主要内容

## 关于采集插件使用的爬虫地址

很多资源网都是公开采集的，打开那些资源网，都会有帮助中心，或者采集教程，会有对应的采集接口地址
如果需要开发采集插件，可以在 Dart-Cms/script/ 下创建一个目录（非中文），里面需要有两个文件，app.js，config.json，请查看上面↑
关于一些资源网采集接口的参数说明，比如123ku, http://cj.okzy.tv/inc/api.php?ac=videolist&pg=1 ，这里ac=videolist指的是获取所有视频列表，pg=1指的是当前数据的页码是1
更多资料，需要自己查询对应的资源网，或者咨询资源网开发人员

## 捐助一下失业的我
<p align="center">
    <img width="300" src="https://cdn.jsdelivr.net/gh/abcd498936590/pic@master/img/alipay.jpg" />
    <img width="300" src="https://cdn.jsdelivr.net/gh/abcd498936590/pic@master/img/tenpay.jpg" />
</p>
