// Auth module — re-exports the router for mounting in the main server.
// The main server (gateway/src/index.js) owns: dotenv, cors, express.json, mongoose, app.listen
// Business logic stays untouched in routes/auth.js

export { default } from './routes/auth.js'
