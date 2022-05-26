require("dotenv").config()
import * as express from 'express'
import * as fs from 'fs'
import { setlog } from './helper'
import * as line from '@line/bot-sdk'
import { Bettings, Config, Rounds, Users } from './Model';
import { createCanvas, Image } from 'canvas'
const axios = require('axios');
const FormData = require('form-data');

import enUS from './locales/en-US'
import zhCN from './locales/zh-CN'
import thTH from './locales/th-TH'

export const locales = {
    "en-US": enUS,
    "zh-CN": zhCN,
    "th-TH": thTH,
} as {[lang:string]:{[key:string]:string}}

let lang = 'th-TH'

const middleware = line.middleware;

const router = express.Router()

const now = () => Math.round(new Date().getTime() / 1000)

const adminChatId = process.env.ADMIN_CHATID || ''
const channelAccessToken = process.env.CHANNEL_ACCESSTOKEN || ''
const channelSecret = process.env.CHANNEL_SECRET || ''
const serverUrl = process.env.SERVER_URL || ''

const config = { channelAccessToken, channelSecret, };
const client = new line.Client({ channelAccessToken });
const isAdmin = (userId: string) => userId === adminChatId

const pinataApiKey = process.env.PINATA_APIKEY;
const pinataSecretApiKey = process.env.PINATA_SECRET;

const urlFile = 'https://api.pinata.cloud/pinning/pinFileToIPFS';
const urlJSON = 'https://api.pinata.cloud/pinning/pinJSONToIPFS';

interface RoundResultType {
	roundId: number
	result: string
}

// 管理命令
const AdminCommands = {
	start: "/Q",		// 开始下注
	stop: "/B",			// 停止下注
	deposit: "/D",			// 用户充值 /D ID 金额  提现 /D ID -金额 
	result: "/S",			// 设置结果和查看
	listUsers: "/L", 			// 查看所有用户
	pastRounds: "/N", //显示过去10期开奖记录
	listBets: '/K',  //查看下注数
	setBank: "/set"			// 设置收款账户
}
// 客户命令
const GuestCommands = {
	cancel: "/X",
	balance: "/C",
	help: "/A",
	showBank: "/Y",			// 管理收款账户
	methodSingle: "/"
}

// 投注命令 （改时候，别用短号或空白字）
const BetCommands = {
	big: "ส",
	small: "ต",
	odd: "ดี",
	even: "คู่",
}
const BetCommandList = Object.values(BetCommands).map(i => i.toLowerCase())
//非数字，非大小单双的其他字符 作为 分隔符
const BetCommandPattern = new RegExp('[^0-9' + BetCommandList.join('') + ']', 'g')

let currentRound = {
	roundId: 0,
	started: false,
	stopped: false
}
const names = {} as { [id: number]: string }
const images = {} as { [key: string]: Image }
const T = (key:string) => {
	if (locales[lang][key]===undefined) throw new Error('undefined lang key [' + key + ']')
	return locales[lang][key]
}

//封装回复信息方法
export const replyMessage = (uid: number | null, replyToken: string, message: string) => {
	let text = ''
	if (uid !== null) {
		if (uid === 0) {
			text = T('MSG_REPLY_ADMIN')
		} else {
			if (names[uid] !== undefined) {
				text = T('MSG_REPLY_GUEST').replace('{uid}', `${String(uid)} (${names[uid]})`)
			} else {
				text = T('MSG_REPLY_GUEST').replace('{uid}', String(uid))
			}
		}
		text += '\r\n\r\n'
	}
	text += message
	const data = { type: 'text', text } as line.Message;

	client.replyMessage(replyToken, data).then((res) => {
		console.log(res)
	}).catch((err) => {
		setlog(err)
	});
}

export const replyFlexMessage = (replyToken: string, data: line.Message) => {
	
	/* let text = ''
	if (uid !== null) {
		if (uid === 0) {
			text = T('MSG_REPLY_ADMIN')
		} else {
			if (names[uid] !== undefined) {
				text = T('MSG_REPLY_GUEST').replace('{uid}', `${String(uid)} (${names[uid]})`)
			} else {
				text = T('MSG_REPLY_GUEST').replace('{uid}', String(uid))
			}
		}
		text += '\r\n\r\n'
	}
	text += message
	const data = { type: 'text', text } as line.Message; */

	client.replyMessage(replyToken, data).then((res) => {
		console.log(res)
	}).catch((err) => {
		setlog(err)
	});
}

export const pushMessage = (chatId: string, text: string) => {
	const data = { type: 'text', text } as line.Message;

	client.pushMessage(chatId, data).then((res) => {
		console.log(res)
	}).catch((err) => {
		// console.log('message', text)
		setlog("pushMessage", err)
	});
}


//line 客户端返回图片
export const replyImage = async (replyToken: string, uri: string) => {
	const message = {
		type: 'image',
		originalContentUrl: uri,
		previewImageUrl: uri
	} as line.Message

	client.replyMessage(replyToken, message).then((res) => {
		// setlog("pushMessage", res)
	}).catch((err) => {
		setlog("replyMessage", err)
	});
}

const getImage = (src: string): Promise<Image | null> => {
	return new Promise(resolve => {
		const buf = fs.readFileSync(src)
		const img = new Image()
		img.onload = () => resolve(img)
		img.onerror = err => resolve(null)
		img.src = buf
	})
}

export const initApp = async () => {
	const _fileDir = __dirname + '/../assets'
	const files = fs.readdirSync(_fileDir)
	for (let i of files) {
		if (i.slice(-4) !== '.png') continue
		const image = await getImage(_fileDir + '/' + i)
		if (image) images[i.slice(0, -4)] = image
	}
	const users = await Users.find().toArray()
	for (let i of users) names[i.id] = i.displayName

	const row = await Rounds.findOne({ result: { $exists: false } })
	if (row !== null) {
		currentRound.roundId = row.roundId || 1001
		currentRound.started = !!row.started
		currentRound.stopped = !!row.stopped
	}
}

const hook = (req: express.Request, res: express.Response) => {

	console.log('body', req.body)
	if (req.body.events && req.body.events.length !== 0) {
		const event = req.body.events[0]
		const { message, source } = event
		handleWebHook(event, source, message)
	}
	res.status(200).send('');
}

router.post("/webhook", middleware(config), hook);

/* router.post("/webhook-test", (req:express.Request, res:express.Response)=>{
	const body = req.body
	res.status(200).send('');
}) */

const pinFileToIPFS = async (fileName:string) => {
    let data = new FormData();
    data.append('file', fs.createReadStream(fileName));
    /* const metadata = JSON.stringify({ name });
    data.append('pinataMetadata', metadata); */
    /* const pinataOptions = JSON.stringify({
        cidVersion: 0,
        customPinPolicy: {
            regions: [
                {
                    id: 'FRA1',
                    desiredReplicationCount: 1
                },
                {
                    id: 'NYC1',
                    desiredReplicationCount: 2
                }
            ]
        }
    });
    data.append('pinataOptions', pinataOptions); */
    var res = await axios
        .post(urlFile, data, {
            maxBodyLength: 'Infinity',
            headers: {
                'Content-Type': `multipart/form-data; boundary=${data._boundary}`,
                pinata_api_key: pinataApiKey,
                pinata_secret_api_key: pinataSecretApiKey
            }
        });
        
    return Promise.resolve(res)
}

const getDiceImage = async (text: string) => {
	if (text.length === 3) {
		const w = 800
		const h = 600
		const diceSize = 128
		let left = 120
		let top = 370
		let spacing = (w - left * 2 - diceSize * 3) / 2
		const canvas = createCanvas(w, h)
		const context = canvas.getContext('2d')

		context.drawImage(images['background'], 0, 0)

		const nums = text.split('')
		for (let k = 0; k < nums.length; k++) {
			const x = left + (diceSize + spacing) * k
			const y = top
			context.drawImage(images[nums[k]], x, y)
		}
		const title = T('MSG_RESULT').replace('{roundId}', String(currentRound.roundId))
		context.font = 'bold 40pt Menlo'
		context.textAlign = 'center'
		context.fillStyle = '#fff'
		context.fillText(title, w / 2, 110)

		const buffer = canvas.toBuffer('image/jpeg')
		const filename = +new Date() + '.jpg'
		/* const buffer = canvas.toBuffer('image/png')
		const filename = +new Date() + '.png' */
		fs.writeFileSync(__dirname + '/../images/' + filename, buffer)
		// return serverUrl + filename
		const res = await pinFileToIPFS(__dirname + '/../images/' + filename)
		/* console.log('https://ipfs.io/ipfs/' + res.data.IpfsHash)
		return 'https://ipfs.io/ipfs/' + res.data.IpfsHash */
		const ipfsUri = 'https://gateway.pinata.cloud/ipfs/' + res.data.IpfsHash
		console.log('getDiceImage', ipfsUri)
		// return 'https://ipfs.io/ipfs/' + res.data.IpfsHash
		return ipfsUri
	}
	return null
}

const getPastResultImage = async (rows: Array<RoundResultType>) => {
	const diceSize = 80
	let left = 50
	let top = 50
	let spacing = 25

	const w = 800
	const h = top * 2 + (diceSize + spacing) * rows.length

	const diceLeft = w - left - diceSize * 3 - spacing * 2
	const canvas = createCanvas(w, h)
	const context = canvas.getContext('2d')

	// context.drawImage(images['background'], 0, 0)
	// draw header 

	for (let m = 0; m < rows.length; m++) {
		const i = rows[m]

		const title = `Round #${i.roundId}`
		context.font = '40pt Menlo'
		context.textAlign = 'left'
		// context.fillStyle = '#fff'

		context.fillText(title, left, top + (diceSize + spacing) * m + (diceSize + 40) / 2)

		const nums = i.result.split('')
		for (let k = 0; k < nums.length; k++) {
			const x = diceLeft + (diceSize + spacing) * k
			const y = top + (diceSize + spacing) * m
			context.drawImage(images[nums[k]], 0, 0, 128, 128, x, y, diceSize, diceSize)
		}
	}
	const buffer = canvas.toBuffer('image/png')
	const filename = +new Date() + '.png'
	fs.writeFileSync(__dirname + '/../images/' + filename, buffer)
	// return serverUrl + filename
	const res = await pinFileToIPFS(__dirname + '/../images/' + filename)
	const ipfsUri = 'https://gateway.pinata.cloud/ipfs/' + res.data.IpfsHash
	console.log('getPastResultImage', ipfsUri)
	// return 'https://ipfs.io/ipfs/' + res.data.IpfsHash
	return ipfsUri
}



const handleWebHook = async (event: any, source: ChatSourceType, message: ChatMessageType): Promise<boolean> => {
	try {
		if (message.type !== "text") return false


		if (event.type == "memberJoined") {


		}
		const replyToken = event.replyToken
		const p = message.text.indexOf(' ')
		let cmd = '', params = ''
		if (p === -1) {
			cmd = message.text.trim()
		} else {
			cmd = message.text.slice(0, p).trim()
			params = message.text.slice(p + 1).trim()
		}
		if (isAdmin(source.userId)) {
			const result = await parseAdminCommand(source.groupId || '', replyToken, cmd, params)
			if (result === true) return true
		}
		return await parseCommand(source.groupId || '', source.userId, replyToken, cmd, params)
	} catch (error) {
		console.log(error)
	}
	return false
};


//处理输入 分割 大小单双 和数字 【大，2】 【2，大】[33]
const validateCommand = (cmd: string): string[] | null => {
	const result = [] as string[]
	const len = cmd.length
	let k = 0
	let isSpec = false
	//如果同时下注两个相同的数，告诉客户非法输入
	if(cmd.length===2 && cmd[0]===cmd[1])
	{
		//如果两个都位数字
		return null
	}
	while (k < len) {
		let pk = k
		for (let i of BetCommandList) {
			//查找 大小单双 出现的位置 记录 为 k
			if (cmd.slice(k).indexOf(i) === 0) {
				if (isSpec) return null
				isSpec = true
				k += i.length
				result.push(i)
				if (k === len - 1) break
			}
		}
		if (k < len) {
			if (/[1-6]/.test(cmd[k])) {
				result.push(cmd[k])
				k++
			}
		}
		if (pk === k) return null
	}
	return result.length === 0 ? null : result
}
const dices = [
	'https://upload.wikimedia.org/wikipedia/commons/c/c5/Dice-1.png',
	'https://upload.wikimedia.org/wikipedia/commons/1/18/Dice-2.png',
	'https://upload.wikimedia.org/wikipedia/commons/7/70/Dice-3.png',
	'https://upload.wikimedia.org/wikipedia/commons/a/a9/Dice-4.png',
	'https://upload.wikimedia.org/wikipedia/commons/6/6c/Dice-5.png',
	'https://upload.wikimedia.org/wikipedia/commons/7/7a/Dice-6E.png',
]


const parseAdminCommand = async (groupId: string, replyToken: string, cmd: string, param: string): Promise<boolean> => {
	try {
		switch (cmd) {
			case AdminCommands.start:
				{
					if (currentRound.roundId !== 0) {
						await replyMessage(0, replyToken, T('ERROR_ALREADY_STARTED').replace('{roundId}', String(currentRound.roundId)))
						return false
					}
					await startRound()
					await replyMessage(0, replyToken, T('MSG_STARTED').replace('{roundId}', String(currentRound.roundId)))
				}
				break

			case AdminCommands.listBets:
				{
					//输出用户投注情况
					const result = await getUsersBetsList()
					if (result.length) {
						let ls = []
						for (let i of result) {
							const t1 = `#${i.uid}`
							const name = names[i.uid]
							const t2 = `${i.betsdetails}`
							let str = t1 + '(' + names[i.uid] + '):' + t2
							ls.push({ "type": "text", "adjustMode": "shrink-to-fit", "text": str })
						}
						//await pushMessage(groupId, MSG_RESULT.replace('{roundId}', String(roundId)) + '\r\n\r\n' + ls.join('\r\n'))
						//格式化输出变成 FLEX文件
						const fs = require('fs');
						let rawdata = fs.readFileSync(__dirname + '/../assets/output_temp.json');
						let output_template = JSON.parse(rawdata);
						output_template["contents"]["header"]["contents"][0]["text"] = String(currentRound.roundId) + 'ประวัติการเดิมพันรอบ'
						output_template["contents"]["body"]["contents"] = ls
						var data = output_template as line.Message;
						console.log(data)
						await client.pushMessage(groupId, data)
							.then(() => {
								console.log('success')
							})
							.catch((err) => {
								// error handling
							});
					}
				}
				break
			case AdminCommands.stop:
				{
					if (currentRound.roundId === 0 || !currentRound.started) {
						await replyMessage(0, replyToken, T('MSG_NOT_STARTED'))
						return false
					}
					if (currentRound.stopped) {
						await replyMessage(0, replyToken, T('ERROR_ALREADY_STOPPED').replace('{roundId}', String(currentRound.roundId)))
						return false
					}

					await replyMessage(0, replyToken, T('MSG_STOPPED').replace('{roundId}', String(currentRound.roundId)))
					await stopRound()

				}
				break

			case AdminCommands.listUsers:
				{
					//查看参与游戏的用户详细情况
					let ls = []
					const rows = await getUserList()
					if (rows.length === 0) {
						await replyMessage(0, replyToken, 'ขณะนี้ไม่มีผู้ใช้ที่เข้าร่วมในเกม')
						return false
					}
					for (let i of rows) {
						//打印输出用户的ID号，姓名，金额
						let str = `${i.uid}(${i.name}):余额 ${i.balance}💰💰`
						ls.push({ "type": "text", "adjustMode": "shrink-to-fit", "text": str })
						//ls.push(`用户${i.uid}(${i.name}):账户余额 ${i.balance}💰💰`)
					}
					//机器人发送消息到Line 群
					//格式化输出变成 FLEX文件
					const fs = require('fs');
					let rawdata = fs.readFileSync(__dirname + '/../assets/output_temp.json');
					let output_template = JSON.parse(rawdata);
					output_template["contents"]["header"]["contents"][0]["text"] = "ยอดผู้ใช้"
					output_template["contents"]["body"]["contents"] = ls
					var data = output_template as line.Message;
					console.log(data)
					await client.pushMessage(groupId, data)
						.then(() => {
							console.log('success')
						})
						.catch((err) => {
							console.log(err)
						});
				}
				break
			case AdminCommands.pastRounds:
				{
					const rows = await getPastResults()
					const fs = require('fs');
					let rawdata = fs.readFileSync(__dirname + '/../assets/result.json');
					let output_template = JSON.parse(rawdata);
					output_template["contents"]["header"]["contents"][0]["text"] = "ยอดผู้ใช้"

					const contents = [] as any[]
					if (rows.length) {
						//给 contents 里面加 Box
						for(let i of rows)
						{
	
							let innerContents = [] as any[]
							//输入文字第几轮
							innerContents.push({
								type: "text",
								text: `#${i.roundId}`,
								color: "#e94700",
								weight: "bold"
							})
							//打印开奖结果
							const nums = i.result.split('')
							for (let k = 0; k <nums.length; k++) {
								innerContents.push({
									type: "image",
									url: dices[Number(nums[k]) - 1],
									size: "50%",
									aspectRatio: "1:1"
								})
							}
							contents.push({
								type: "box",
								layout: "horizontal",
								contents:innerContents,
								spacing: "sm"
							})
						}
						output_template["contents"]["body"]["contents"] = contents
						var data = output_template as line.Message;
						console.log(data)
						await client.pushMessage(groupId, data)
							.then(() => {
								console.log('success')
							})
							.catch((err) => {
								console.log(err)
							});
					} else {
						await replyMessage(0, replyToken, T('ERROR_NO_RESULT'))
					}
				}
				break
			case AdminCommands.deposit:
				{
					if (param === '') {
						await replyMessage(0, replyToken, T('ERROR_INVALID_PARAM'))
						return false
					}
					const [sid, samount] = param.split(' ')
					const id = Number(sid)
					const amount = Number(samount)
					if (isNaN(id) || isNaN(amount)) {
						await replyMessage(0, replyToken, T('ERROR_INVALID_PARAM'))
						return false
					}
					const user = await getUserById(id)
					if (user === null) {
						await replyMessage(0, replyToken, T('ERROR_NOT_EXISTS_USER'))
					} else {
						//正数为充值，负数为提现
						const balance = user.balance + amount
						if (balance < 0) {
							//提现情况如果剩余金额小于零，提现金额大于用户余额
							await replyMessage(id, replyToken, '该用户余额不足以提现')
							return false
						}
						await updateUser(id, { balance, updated: now() })
						if (amount >= 0) {
							await replyMessage(id, replyToken, T('MSG_DEPOSIT_SUCCESS').replace('{amount}', String(amount)))
						}
						else {
							await replyMessage(id, replyToken, T('MSG_WITHDRAW_SUCCESS').replace('{amount}', String(amount)))
						}
						await replyMessage(id, replyToken, user.id + T('MSG_BALANCE').replace('{balance}', String(balance)))
					}
				}
				break
			case AdminCommands.result:
				{
					if (groupId !== '') {
						const roundId = currentRound.roundId
						if (roundId !== 0 && currentRound.started) {
							if (!/^[1-6]{3,3}$/.test(param)) {
								await replyMessage(0, replyToken, T('ERROR_UNKNOWN_COMMAND'))
								return false
							}
							const contents = [] as any[]
							const nums = param.split('')
							for (let k = 0; k < nums.length; k++) {
								contents.push({
									type: "image",
									url: dices[Number(nums[k]) - 1],
									size: "50%",
									aspectRatio: "1:1"
								})
							}
							console.log(contents)
							const fs = require('fs');
							let rawdata = fs.readFileSync(__dirname + '/../assets/output_temp.json');
							let output_template = JSON.parse(rawdata);
							output_template["contents"]["header"]["contents"][0]["text"] = T('MSG_RESULT').replace('{roundId}', String(roundId))
							output_template["contents"]["body"]["layout"] = "horizontal"
							output_template["contents"]["body"]["contents"] = contents
							// var data = output_template as line.Message;
							await client.pushMessage(groupId, output_template)
								.then(() => {
									console.log('success')
								})
								.catch((err) => {
									console.log(err)
								});
							const result = await updateRoundAndGetResults(param)
							if (result.length) {
								let ls = []
								for (let i of result) {
									const t1 = `#${i.uid}`
									const t2 = `${(i.rewards > 0 ? '+' : '') + i.rewards} = ${i.balance}`
									let str = t1 + '(' + names[i.uid] + ')' + ' '.repeat(30 - t1.length - t2.length) + t2
									ls.push({ "type": "text", "adjustMode": "shrink-to-fit", "text": str })
								}
								//await pushMessage(groupId, MSG_RESULT.replace('{roundId}', String(roundId)) + '\r\n\r\n' + ls.join('\r\n'))
								//格式化输出变成 FLEX文件
								const fs = require('fs');
								let rawdata = fs.readFileSync(__dirname + '/../assets/output_temp.json');
								let output_template = JSON.parse(rawdata);
								output_template["contents"]["header"]["contents"][0]["text"] = T('MSG_RESULT').replace('{roundId}', String(roundId))
								output_template["contents"]["body"]["contents"] = ls
								// var data = output_template as line.Message;
								await client.pushMessage(groupId, output_template)
									.then(() => {
										console.log('success')
									})
									.catch((err) => {
										// error handling
									});
							}
							/* } else {
								await replyMessage(0, replyToken, T('ERROR_UNKNOWN_ERROR'))
							} */
						} else {
							await replyMessage(0, replyToken, T('MSG_NOT_STARTED'))
						}
					} else {
						await replyMessage(0, replyToken, T('ERROR_GROUP_COMMAND'))
					}
				}
				break
			case AdminCommands.setBank:
				{
					if (param === '') {
						await replyMessage(0, replyToken, T('ERROR_INVALID_PARAM'))
						return false
					}
					await setConfig("bank", param)
					await replyMessage(0, replyToken, T('MSG_SET_BANK'))
				}
				break
			default:
				return false
		}
		return true
	} catch (error) {
		setlog("parseAdminCommand", error)
		await replyMessage(null, replyToken, T('ERROR_UNKNOWN_ERROR'))
	}
	return false
}

const checkRound = async (uid: number, replyToken: string) => {
	if (!currentRound.started) {
		await replyMessage(uid, replyToken, T('MSG_NOT_STARTED'))
		return false
	}
	if (currentRound.stopped) {
		await replyMessage(uid, replyToken, T('MSG_STOPPED').replace('{roundId}', String(currentRound.roundId)))
		return false
	}
	return true
}

const parseCommand = async (groupId: string, userId: string, replyToken: string, cmd: string, param: string): Promise<boolean> => {
	try {
		// if (groupId!=='') await insertGroupId(groupId)
		const user = await getOrCreateUser(groupId, userId)
		const uid = user.id

		switch (cmd) {
			case GuestCommands.cancel:
				{
					const _round = await checkRound(uid, replyToken)
					if (!_round) return false
					const rows = await Bettings.find({ uid }).toArray()
					if (rows && rows.length) {
						let total = 0
						for (let i of rows) {
							total += i.amount
						}
						await Bettings.deleteMany({ uid })
						await updateUser(userId, { balance: user.balance + total })
						await replyMessage(uid, replyToken, T('MSG_CANCEL_BET'))
					} else {
						await replyMessage(uid, replyToken, T('ERROR_NOT_BETTED'))
					}
				}
				break
			case GuestCommands.balance:
				{
					await replyMessage(uid, replyToken, T('MSG_BALANCE').replace('{balance}', String(user.balance)))
				}
				break
			case GuestCommands.help:
				{
					await replyMessage(uid, replyToken, T('MSG_GAME_RULE'))
				}
				break
			case GuestCommands.showBank:
				{
					const bank = await getConfig("bank")
					if (bank !== "") {
						await replyMessage(uid, replyToken, T('MSG_BANK') + '\r\n' + bank)
					}
				}
				break
			case "/test-image":
				{
					let contents = []
					const nums = param.split('')
					for (let k = 0; k < nums.length; k++) {
						contents.push({
							type: "image",
							url: dices[ Number(nums[k]) - 1 ],
							size: "10%"
							// aspectRatio: "1:1"
						})
					}
					console.log(contents)
					const fs = require('fs');
					let rawdata = fs.readFileSync(__dirname + '/../assets/result.json');
					let output_template = JSON.parse(rawdata);
					output_template["contents"]["header"]["contents"][0]["text"] = '操'
					output_template["contents"]["body"]["contents"] = contents
					// var data = output_template as line.Message;
					await client.pushMessage(groupId, output_template)
						.then(() => {
							console.log('success')
						})
						.catch((err) => {
							console.log(err)
						});
				}
				break
			default:
				{
					// 处理多行命令
					const lines = (cmd + ' ' + param).toLowerCase().split(/\r\n|\r|\n/g)
					const bs = [] as Array<{ bets: string[], amount: number }>
					let total = 0
					//对于每一行命令
					for (let line of lines) {
						//使用分隔符分开 命令 和 金额 分隔符是 非 数字 和 大小单双的符号
						const x = line.trim().split(BetCommandPattern)

						if (x.length === 2 || x.length === 3) {
							let bets = [] as string[]
							for (let k = 0; k < x.length - 1; k++) {
								//对命令进行处理
								const cs = validateCommand(x[k])
								if (cs === null) {
									await replyMessage(uid, replyToken, T('ERROR_UNKNOWN_COMMAND'))
									return false
								}
								if (cs.length > 2) return false
								for (let i of cs) {
									bets.push(i)
								}
							}
							if (bets.length) {
								//处理金额 写入数据库
								const amount = Number(x[x.length - 1])
								if (isNaN(amount)) {
									// await replyMessage(uid, replyToken, ERROR_UNKNOWN_COMMAND)
									return false
								} else {
									total += amount
								}
								bs.push({ bets, amount })
							}
						}
					}
					//查看目前是第几轮
					const _round = await checkRound(uid, replyToken)
					if (!_round) return false

					if (bs.length === 0) {
						// await replyMessage(uid, replyToken, ERROR_UNKNOWN_COMMAND)
						return false
					}
					//本次下注的金额 大于 余额报错
					if (total > user.balance) {
						await replyMessage(uid, replyToken, T('ERROR_BET_BALANCE'))
						return false
					}
					let ls = [] as string[]
					const balance = user.balance - total
					//更新用户余额
					await updateUser(userId, { balance })
					//统计用户所有下注记录
					total = 0
					const rows = await addAndGetBetting(user.id, bs)
					for (let i of rows) {
						total += i.amount
						//打印输出用户的下注记录
						ls.push(` ✅${i.cmd} => ${i.amount}💰`)
					}
					ls.push(T('MSG_BET_TOTAL').replace('{total}', String(total)))
					ls.push(T('MSG_BALANCE').replace('{balance}', String(balance)))
					//机器人发送消息到Line 群
					await replyMessage(uid, replyToken, ls.join('\r\n'))
					return true
				}
				// await replyMessage(uid, replyToken, ERROR_UNKNOWN_COMMAND)
				break
		}
		return true
	} catch (error) {
		setlog("parseCommand", error)
		await replyMessage(null, replyToken, T('ERROR_UNKNOWN_ERROR'))
	}
	return false
}

const getUserById = async (id: number) => {
	return await Users.findOne({ id })
}

/* const insertGroupId = async (groupId:string) => {
	await Groups.updateOne({ groupId }, { $set: { groupId, updated:now() } }, { upsert:true })
} */

const startRound = async () => {
	let roundId = 1001
	const rows = await Rounds.aggregate([{ $group: { _id: null, max: { $max: "$roundId" } } }]).toArray();
	if (rows.length > 0) {
		roundId = rows[0].max + 1
	}
	await Rounds.insertOne({
		roundId,
		started: true,
		stopped: false,
		totalBetting: 0,
		totalRewards: 0,
		updated: 0,
		created: 0
	})
	currentRound.roundId = roundId
	currentRound.started = true
	currentRound.stopped = false
}

const stopRound = async () => {
	await Rounds.updateOne({ roundId: currentRound.roundId }, { $set: { stopped: true, updated: now() } })
	currentRound.stopped = true
}

//奖金计算 result 开奖结果. amount 赌注金额, bets 下注方式
const calculateRewardsOfBetting = (result: string, amount: number, bets: string[]): number => {
	const rs = result.split('')
	let sum = 0
	let rate = 0
	for (let i of rs) sum += Number(i)
	let isLeopard = rs[0] === rs[1] && rs[1] === rs[2]
	let isSingle = false
	//赌注类型判断
	for (let i of bets) {
		if (BetCommands.small === i) {
			if (isLeopard) return 0
			if (sum >= 4 && sum <= 10) {
				isSingle = true
				rate = rate === 0 ? 2 : 3.3
			} else {
				return 0
			}
		} else if (BetCommands.big === i) {
			if (isLeopard) return 0
			if (sum >= 11 && sum <= 17) {
				isSingle = true
				rate = rate === 0 ? 2 : 3.3
			} else {
				return 0
			}
		} else if (BetCommands.odd === i) {
			if (isLeopard) return 0
			if ((sum % 2) == 1 && sum >= 5 && sum <= 17) {
				isSingle = true
				rate = rate === 0 ? 2 : 3.3
			} else {
				return 0
			}
		} else if (BetCommands.even === i) {
			if (isLeopard) return 0
			if ((sum % 2) == 0 && sum >= 4 && sum <= 16) {
				isSingle = true
				rate = rate === 0 ? 2 : 3.3
			} else {
				return 0
			}
		} else {
			let matchedCount = 0
			for (let r of rs) {
				if (i === r) matchedCount++
			}
			if (matchedCount === 0) return 0
			if (isSingle) { //查到 大小单双后面 有数字，则3.3倍
				rate = 3.3
			} else {
				if (rate !== 0 && matchedCount > 0) {
					rate = 6
				} else {
					if (matchedCount === 1) {
						rate = 2
					} else if (matchedCount === 2) {
						rate = 3
					} else if (matchedCount === 3) {
						rate = 4
					}
				}
			}
		}
	}
	return amount * rate
}

//展示用户本轮下注详细

const getUsersBetsList = async (): Promise<Array<{ uid: number, betsdetails: string }>> => {
	const result = [] as Array<{ uid: number, betsdetails: string }>
	const roundId = currentRound.roundId
	const rows = await Bettings.find({ roundId }).toArray()
	const map1 = new Map();
	if (rows !== null) {
		for (let i of rows) {
			if (!map1.has(i.uid)) {
				let betdetals = i.bets.join() + '=' + i.amount + ' '
				map1.set(i.uid, betdetals);
			}
			else {
				let betdetals = map1.get(i.uid)
				betdetals += i.bets.join() + '=' + i.amount + ' '
				map1.set(i.uid, betdetals);
			}
		}
		for (const [key, value] of map1) {
			result.push({ uid: key, betsdetails: value })
		}
	}
	return result
}


const updateRoundAndGetResults = async (num: string): Promise<Array<{ uid: number, rewards: number, balance: number }>> => {
	const result = [] as Array<{ uid: number, rewards: number, balance: number }>
	const roundId = currentRound.roundId
	const rows = await Bettings.find({ roundId }).toArray()
	const us = {} as { [uid: number]: { bet: number, rewards: number } }
	let totalBetting = 0
	let totalRewards = 0
	if (rows !== null) {
		for (let i of rows) {
			const rewards = calculateRewardsOfBetting(num, i.amount, i.bets)
			us[i.uid] ??= { bet: 0, rewards: 0 }
			us[i.uid].bet += i.amount
			us[i.uid].rewards += rewards
		}
		const users = await Users.find({ id: { $in: Object.keys(us).map(i => Number(i)) } }).toArray()
		for (let i of users) {
			const bet = us[i.id].bet
			const rewards = us[i.id].rewards
			const balance = i.balance + rewards
			if (rewards !== 0) await Users.updateOne({ id: i.id }, { $set: { balance } })
			result.push({ uid: i.id, rewards: rewards - bet, balance })
			totalBetting += us[i.id].bet
			totalRewards += rewards
		}
	}
	currentRound.roundId = 0
	currentRound.started = false
	await Rounds.updateOne({ roundId }, { $set: { result: num, totalBetting, totalRewards, updated: now() } })
	return result
}

const getConfig = async (key: string): Promise<string> => {
	const row = await Config.findOne({ key })
	if (row) return row.value
	return ''
}

const setConfig = async (key: string, value: string) => {
	await Config.updateOne({ key }, { $set: { key, value } }, { upsert: true })
}

const getPastResults = async (): Promise<Array<RoundResultType>> => {
	const result = [] as Array<RoundResultType>
	const rows = await Rounds.find({ result: { $exists: true } }).sort({ roundId: -1 }).limit(10).toArray()
	for (let k = rows.length - 1; k >= 0; k--) {
		const i = rows[k]
		result.push({ roundId: i.roundId, result: i.result || '' })
	}
	return result
}

const addAndGetBetting = async (uid: number, params: Array<{ bets: string[], amount: number }>): Promise<Array<{ cmd: string, amount: number }>> => {
	const inserts = [] as Array<SchemaBettings>
	const created = now()
	for (let i of params) {
		inserts.push({
			roundId: currentRound.roundId,
			uid: uid,
			bets: i.bets,
			amount: i.amount,
			rewards: 0,
			created
		})
	}
	await Bettings.insertMany(inserts)
	const result = [] as Array<{ cmd: string, amount: number }>
	const rows = await Bettings.find({ roundId: currentRound.roundId, uid }).toArray()
	if (rows) {
		for (let i of rows) {
			result.push({ cmd: i.bets.join(''), amount: i.amount })
		}
	}
	return result
}

const getOrCreateUser = async (groupId: string, userId: string) => {
	let row = await Users.findOne({ userId })
	if (row === null) {
		let id = 1001
		const rows = await Users.aggregate([{ $group: { _id: null, max: { $max: "$id" } } }]).toArray();
		if (rows.length > 0) id = rows[0].max + 1
		let displayName = ''
		try {
			//const profile = await client.getProfile(userId)
			const profile = await client.getGroupMemberProfile(groupId, userId)
			displayName = profile.displayName
			console.log('profile', profile)
		} catch (error) {
			console.log(error)
		}

		/* .then((profile) => {
			console.log(profile.displayName);
			console.log(profile.userId);
			console.log(profile.pictureUrl);
			console.log(profile.statusMessage);
		})
		.catch((err) => {
			// error handling
		}); */
		const user = {
			id,
			userId,
			displayName,
			balance: 0,
			updated: 0,
			created: now()
		} as SchemaUsers
		names[id] = displayName
		await Users.insertOne(user)
		return user
	}
	return row
}

const updateUser = async (userId: string | number, params: Partial<SchemaUsers>) => {
	if (typeof userId === "string") {
		await Users.updateOne({ userId }, { $set: params })
	} else {
		await Users.updateOne({ id: userId }, { $set: params })
	}
	return true
}

//获取用户列表
const getUserList = async () => {
	const result = [] as Array<{ uid: number, name: string, balance: number }>
	const rows = await Users.find().toArray()
	if (rows) {
		for (let i of rows) {
			result.push({ uid: i.id, name: i.displayName, balance: i.balance })
		}
	}
	return result
}

export default router