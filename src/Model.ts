require('dotenv').config()
import { MongoClient } from 'mongodb';
import { setlog } from './helper';
const dbname = process.env.DB_NAME || 'dice'
const client = new MongoClient('mongodb://localhost:27017');
const db = client.db(dbname);

export const Config = 	db.collection<SchemaConfig>('config');
export const Users = 	db.collection<SchemaUsers>('users');
// export const Groups = 	db.collection<SchemaGroups>('groups');
export const Rounds = 	db.collection<SchemaRounds>('rounds');
export const Bettings = db.collection<SchemaBettings>('bettings');

const connect = async () => {
	try {
		await client.connect()
		setlog('connected to MongoDB')
		Config.createIndex( {key: 1}, { unique: true })
		Users.createIndex( {userId: 1}, { unique: true })
		Users.createIndex( {id: 1}, { unique: true })
		// Groups.createIndex( {groupId: 1}, { unique: true })
		Rounds.createIndex( {roundId: 1}, { unique: true })
	} catch (error) {
		console.error('Connection to MongoDB failed', error)
		process.exit()
	}
}

export default { connect };