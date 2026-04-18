// Students module — re-exports the router for mounting in the main server.
// The main server (gateway/src/index.js) owns: dotenv, cors, express.json, mongoose, app.listen
// Business logic stays untouched in routes/students.js

export { default } from './routes/students.js'
