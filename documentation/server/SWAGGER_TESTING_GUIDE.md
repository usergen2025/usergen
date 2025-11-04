# 🧪 Swagger Testing Guide

## Quick Start: How to Get and Use JWT Token

### **Step-by-Step Process:**

1. **Start the Auth Service**
   ```bash
   cd server/microservices/auth-service
   npm run start:dev
   ```

2. **Access Swagger UI**
   - Open browser: `http://localhost:9000/api/docs`
   - Enter Basic Auth credentials (if prompted): `admin` / `admin123`

3. **Register or Login to Get Token**
   
   **Option A: Register a New User**
   - Find `POST /auth/register` endpoint
   - Click "Try it out"
   - Fill in the request body:
     ```json
     {
       "name": "Test User",
       "email": "test@example.com",
       "password": "TestPass123!"
     }
     ```
   - Click "Execute"
   - **Copy the `accessToken` from the response** (it's inside `data.tokens.accessToken`)

   **Option B: Login (if user exists)**
   - Find `POST /auth/login` endpoint
   - Click "Try it out"
   - Fill in the request body:
     ```json
     {
       "email": "test@example.com",
       "password": "TestPass123!"
     }
     ```
   - Click "Execute"
   - **Copy the `accessToken` from the response**

4. **Authorize in Swagger**
   - Click the **"Authorize"** button (green lock icon, top right)
   - In the popup, find "JWT-auth"
   - Paste your token in the "Value" field:
     - You can paste just the token: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`
     - OR include "Bearer " prefix: `Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`
   - Click **"Authorize"** button
   - Click **"Close"**

5. **Test Protected Endpoints**
   - Now you can test protected endpoints like `GET /auth/profile`
   - The token will be automatically included in the Authorization header
   - Click "Execute" to test

---

## 📋 Response Examples

All endpoints now include:
- ✅ **Success Response Examples** - Shows what a successful response looks like
- ✅ **Error Response Examples** - Shows what error responses look like
- ✅ **Request Body Examples** - Already existed, now enhanced

You can see these examples in the Swagger UI under each endpoint's "Responses" section.

---

## 🔐 Token Lifecycle

1. **Get Token**: Register or Login → Get `accessToken` and `refreshToken`
2. **Use Token**: Authorize in Swagger → Test protected endpoints
3. **Refresh Token**: Use `refreshToken` to get new `accessToken` when expired
4. **Logout**: Invalidate tokens when done

---

## 📝 Example Workflow

1. **Register** → Get tokens
2. **Copy accessToken** from response
3. **Click "Authorize"** → Paste token → Authorize
4. **Test GET /auth/profile** → Should return your user data
5. **Test POST /auth/logout** → Should logout successfully

---

## 💡 Tips

- **Token Format**: Just paste the token value, Swagger adds "Bearer " automatically
- **Token Expiry**: Access tokens expire in 1 hour (default). Use refresh token to get a new one.
- **Swagger Auto-Saves**: Once authorized, Swagger saves your token for the session
- **Clear Authorization**: Click "Authorize" again and then "Logout" to clear

---

**Need Help?** Check the Swagger UI description for detailed instructions on each endpoint!

