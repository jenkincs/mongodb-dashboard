# MongoDB Local Dashboard

A lightweight local dashboard to connect to MongoDB and manage data with a clean UI. No authentication (intended for local use only).

## Features

- Connect to any MongoDB URI
- List databases and collections
- Query with EJSON: filter, sort, projection, skip, limit
- View results and select documents
- JSON-based editor to add/update/delete documents
- Import (JSON array) and Export (EJSON) documents
- EJSON/ObjectId aware

## Quick Start

1. Install dependencies

```bash
npm install
```

2. Start the server

```bash
npm start
```

- App runs at `http://localhost:3000`
- Enter your connection URI (e.g., `mongodb://localhost:27017`) and click Connect

## API Overview

- `POST /api/connect` body: `{ "uri": "mongodb://..." }`
- `POST /api/disconnect`
- `GET /api/databases`
- `GET /api/databases/:db/collections`
- `GET /api/databases/:db/collections/:coll/documents?filter&sort&projection&skip&limit` (filter/sort/projection accept EJSON/JSON strings)
- `POST /api/databases/:db/collections/:coll/documents` (body is document JSON/EJSON)
- `PUT /api/databases/:db/collections/:coll/documents/:id` (replace by id)
- `PATCH /api/databases/:db/collections/:coll/documents/:id` (update spec, e.g. `{ "$set": { ... } }`)
- `DELETE /api/databases/:db/collections/:coll/documents/:id`
- `POST /api/databases/:db/collections/:coll/import` (body: JSON array of documents)
- `GET /api/databases/:db/collections/:coll/export?filter`

Notes:
- EJSON supports ObjectId via `{ "_id": { "$oid": "..." } }`
- No auth or persistence; intended for trusted local environments only

## Development

- Edit files in `public/` for the UI
- Server in `server.js`

## License

MIT