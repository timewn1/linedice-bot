const BetCommands = {
	big: "大",
	small: "小",
	odd: "单",
	even: "双",
}
const BetCommandList = Object.values(BetCommands).map(i=>i.toLowerCase())

const validateCommand = (cmd) => {
	const result = []
	const len = cmd.length
	let k = 0
	while (k < len) {
		let pk = k
		for (let i of BetCommandList) {
			if (cmd.slice(k).indexOf(i)===0) {
				k += i.length
				result.push(i)
				if (k===len-1) break
			}
		}
		if (k < len) {
			if (/[1-6]/.test(cmd[k])) {
				result.push(cmd[k])
				k++
			}
		}
		if (pk===k) return null
	}
	return result.length===0 ? null : result
}

validateCommand("单小")