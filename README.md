````markdown
# Try It Backend

Backend API for the **Try It Extension**, built using **Node.js**, **Express**, and **MongoDB**.  
Handles user registration, login, OTP verification, and password recovery.

---

## 🚀 Features

- User Registration & Login
- JWT-based Authentication
- Send OTP for Forgot Password
- Verify OTP
- Secure Password Hashing
- RESTful API Design
- MongoDB with Mongoose

---

## 🛠️ Setup Instructions

### 1. Clone the Repository

```bash
git clone https://bitbucket.org/galific_ai/try_it_backend.git
cd try_it_backend
```
````

### 2. Install Dependencies

```bash
npm install
```

### 3. Create `.env` File

See `.env.example` for the full list of variables. Never commit real values.

```env
PORT=5000
MONGO_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/tryItExtension?retryWrites=true&w=majority
JWT_SECRET=replace_with_a_long_random_string
JWT_EXPIRES_IN=30d

```

### 4. Start the Server

```bash
npm run dev   # for development (nodemon)
# or
node server.js   # production
```

---

## 📁 Project Structure

```
try_it_backend/
├── uploads/           # user images
├── routes/            # API routes
├── models/            # Mongoose schemas
├── middlewares/       # JWT, error handling
├── .env               # Environment variables
├── index.js          # Entry point
└── README.md
```

---

## 🔐 Authentication

Most routes require JWT in `Authorization` header:

```http
Authorization: Bearer <token>
```

---

## 📡 API Endpoints

### 👤 User Authentication

#### ✅ Register User

- **POST** `/users/register`
- **Body**:

```json
{
  "firstName": "John",
  "lastName": "Doe",
  "email": "john@example.com",
  "password": "securePass123"
}
```

- **Response**:

```json
{
  "message": "User registered successfully",
  "user": { ... }
}
```

---

#### 🔐 Login

- **POST** `/users/login`
- **Body**:

```json
{
  "email": "john@example.com",
  "password": "securePass123"
}
```

- **Response**:

```json
{
  "token": "JWT_TOKEN",
  "user": { ... }
}
```

---

#### 🙋‍♂️ Get User Details

- **GET** `/users/me`
- **Headers**: `Authorization: Bearer <token>`

---

#### 🗑️ Delete User

- **DELETE** `/users/me`
- **Headers**: `Authorization: Bearer <token>`

---

### 🔁 Forgot Password (Send OTP)

- **POST** `/users/forgot-password`
- **Body**:

```json
{
  "email": "john@example.com"
}
```

- **Response**:

```json
{
  "message": "OTP sent to email"
}
```

---

### ✅ Verify OTP

- **POST** `/users/reset-password`
- **Body**:

```json
{
  "email": "john@example.com",
  "otp": "123456",
  "password": "sssQ123@"
}
```

- **Response**:

```json
{
  "message": "OTP verified successfully"
}
```

---

> 📌 OTP is usually time-limited (e.g., 5 minutes).

---

## 🧪 Testing

Use **Postman**, **Thunder Client**, or browser dev tools to test the API.

---

## ⚙️ Tech Stack

- Node.js
- Express
- MongoDB + Mongoose
- JWT
- Bcrypt
- Dotenv

---

## 📄 License

MIT License

---

## 👨‍💻 Maintained by

**Galific AI Team**
🔗 Bitbucket: [Try It Backend (main)](https://bitbucket.org/galific_ai/try_it_backend/src/main/)

```


```
