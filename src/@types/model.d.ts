declare interface SchemaConfig {
	key: 			string
	value: 			string
}
declare interface SchemaUsers {
	id: 			number
	userId: 		string
	displayName: 	string
	balance:		number
	updated:		number
	created:		number
}

declare interface SchemaRounds {
	roundId:		number
	started:		boolean
	stopped:		boolean
	result?:		string
	totalBetting:	number
	totalRewards:	number
	updated:		number
	created:		number
}

declare interface SchemaBettings {
	roundId:		number
	uid:			number
	bets:			string[]
	amount:			number
	rewards:		number
	created:		number
}

/*
declare interface SchemaGroups {
	groupId:		string
	updated:		number
}
*/

declare interface ChatSourceType {
	type:			"user"|"group"
	groupId?:		string
	userId:			string
}

declare interface ChatMessageType {
	type: 			"text",
	id: 			number
	text: 			string
}