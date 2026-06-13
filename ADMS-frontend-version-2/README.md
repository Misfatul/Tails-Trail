# Tails Trail

Tails Trail is now a small full-stack web app for the project **Design and Implementation of a Web-Based Pet Care and Health Record Management System Using Advanced DBMS**.

It uses:

- `HTML`, `CSS`, and vanilla `JavaScript` for the frontend
- `Node.js` and `Express` for the backend API
- `MySQL` for the database

## Features

- Owner registration
- Token-based owner login, auth persistence, and logout
- Pet create, update, delete, and view
- Responsive authenticated pet dashboard with pet cards
- Pet profile modal with medical, vaccination, deworming, care, weight, and adoption history
- Medical record create/edit/delete with prescription image upload
- Vaccination create/edit/delete with duplicate prevention surfaced from the SQL trigger
- Deworming create/edit/delete with due-date behavior surfaced from the SQL trigger
- Care record create/edit/delete
- Weight create/edit/delete with a simple progress chart
- Pet transfer/adoption flow using the SQL ownership trigger
- Dashboard reminders for due vaccination and deworming items
- Sample data seeding from the UI

## Project Structure

```text
ADMS-frontend-version-2/
|-- index.html
|-- styles.css
|-- script.js
|-- server.js
|-- db.js
|-- schema.sql
|-- package.json
|-- .env.example
|-- README.md
`-- screenshots/
```

## Database Setup

1. Open MySQL.
2. Run the SQL from `schema.sql` in this project folder.

If you want to use your own script instead, make sure:

- the database name is `tailstrail_dbms`
- all tables from your schema exist
- the triggers are created
- at least one owner exists before inserting transfer records

The application uses the exact schema in `schema.sql`. Pet cards derive health summaries, latest weight, and vaccine/deworming reminders from the record tables instead of adding extra columns to `pets`.

## App Setup

1. Open the project folder in a terminal:

```powershell
cd "c:\Users\Administrator\Documents\7th sem project\Tail trails\ADMS-frontend-version-2"
```

2. Install dependencies:

```powershell
npm install
```

3. Create a `.env` file by copying `.env.example`.

4. Update these values in `.env`:

```env
PORT=8080
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_mysql_password
DB_NAME=tailstrail_dbms
JWT_SECRET=replace_with_a_long_random_secret
```

5. Start the server:

```powershell
npm start
```

6. Open:

```text
http://localhost:8080
```

## API Routes

```text
GET    /api/owners
POST   /api/auth/register
POST   /api/auth/login
GET    /api/auth/me
PUT    /api/profile
PUT    /api/profile/password
GET    /api/dashboard
GET    /api/pets
POST   /api/pets
PUT    /api/pets/:id
DELETE /api/pets/:id
GET    /api/pets/:id/full-record
GET    /api/pets/:petId/medical
POST   /api/medical
PUT    /api/medical/:id
DELETE /api/medical/:id
POST   /api/vaccinations
PUT    /api/vaccinations/:id
DELETE /api/vaccinations/:id
POST   /api/deworming
PUT    /api/deworming/:id
DELETE /api/deworming/:id
POST   /api/care
PUT    /api/care/:id
DELETE /api/care/:id
POST   /api/weights
PUT    /api/weights/:id
DELETE /api/weights/:id
POST   /api/uploads/prescription
POST   /api/transfers
GET    /api/pets/:petId/transfers
POST   /api/seed
```

## How to Use

1. Register an owner or log in with `misfa@gmail.com` / `12345`.
2. Add pets from the `Pet Form` section.
3. Add medical, vaccination, deworming, care, and weight entries from `Records`.
4. Click a pet card to view full details and edit/delete record history.
5. Use `Transfer` to adopt a pet to another owner.

## Notes

- Passwords are hashed with bcrypt for new accounts and legacy plain-text passwords are upgraded after a successful login.
- API routes that read or change owner pet data require a bearer token from `/api/auth/login`.
- The backend deletes child records before deleting a pet because your foreign keys do not currently use `ON DELETE CASCADE`.
- The transfer trigger updates the current owner in the `pets` table automatically.
