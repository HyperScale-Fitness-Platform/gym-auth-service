const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const userModel = require("../models/user.model");
const { producer } = require("../config/kafka");

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRY = process.env.JWT_EXPIRY;
const PASSWORD_SALT_ROUNDS = parseInt(process.env.PASSWORD_SALT_ROUNDS, 10);

async function register({ email, password, role, phone, full_name, bio, gender, photo_url }) {
  if (!email || !password || !role) {
    throw { status: 400, message: "email, password, and role are required" };
  }

  const existing = await userModel.findByEmail(email);
  if (existing) {
    throw { status: 409, message: "user already exists" };
  }

  const passwordHash = await bcrypt.hash(password, PASSWORD_SALT_ROUNDS);
  
  const user = await userModel.create({ email, passwordHash, role, phone });

  if (role === "trainer") {
    await producer.send({
      topic: "trainer_creation",
      messages: [{
        key: user.id, 
        value: JSON.stringify({
          id: user.id,
          full_name,
          bio,
          gender,
          photo_url
        }),
      }],
    });
  } else if (role === "customer") {
    await producer.send({
      topic: "customer_creation",
      messages: [{
        key: user.id, 
        value: JSON.stringify({
          id: user.id,
          full_name,
          gender,
          phone
        }),
      }],
    });
  }

  return { id: user.id, email: user.email, role: user.role };
}

async function login({ email, password }) {
  const user = await userModel.findByEmail(email);
  if (!user) {
    throw { status: 401, message: "invalid credentials" };
  }

  const passwordMatches = await bcrypt.compare(password, user.password_hash);
  if (!passwordMatches) {
    throw { status: 401, message: "invalid credentials" };
  }

  const token = jwt.sign(
    { sub: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRY }
  );

  return { token };
}

function verifyToken(token) {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return { valid: true, decoded };
  } catch (err) {
    return { valid: false };
  }
}

async function deleteUser(id) {
  if (!id) {
    throw { status: 400, message: "user id is required" };
  }

  // 1. Delete from Auth database first (You must implement deleteById in user.model.js)
  const deletedCount = await userModel.deleteById(id);
  
  if (deletedCount === 0) {
    throw { status: 404, message: "user not found" };
  }

  // 2. Publish deletion event to Kafka
  await producer.send({
    topic: "deleted_users",
    messages: [{
      key: id, 
      value: JSON.stringify({ id }),
    }],
  });

  return { message: "user deleted successfully" };
}


async function updateUser(id, { email, password, is_active, old_password, new_password }) {
  if (!id) {
    throw { status: 400, message: "user id is required" };
  }
  const hasEmail = !!email;
  const hasPassword = !!password || (!!old_password && !!new_password);
  const hasIsActive = typeof is_active === "boolean";
  if (!hasEmail && !hasPassword && !hasIsActive) {
    throw { status: 400, message: "either email, password, or is_active is required to update" };
  }

  const updates = {};

  // 1. Handle Email Update
  if (email) {
    const existingUser = await userModel.findByEmail(email);
    // If the email exists and belongs to a DIFFERENT user, block it
    if (existingUser && existingUser.id !== id) {
      throw { status: 409, message: "email already in use by another account" };
    }
    updates.email = email;
  }

  // 2. Handle Password Update
  if (hasPassword) {
    const user = await userModel.findById(id);
    if (!user) {
      throw { status: 404, message: "user not found" };
    }
    // If old_password is provided, verify it matches before changing
    if (old_password) {
      const matches = await bcrypt.compare(old_password, user.password_hash);
      if (!matches) {
        throw { status: 401, message: "old password is incorrect" };
      }
    }
    updates.passwordHash = await bcrypt.hash(password || new_password, PASSWORD_SALT_ROUNDS);
  }

  // 3. Handle is_active Update
  if (typeof is_active === "boolean") {
    updates.isActive = is_active;
  }

  // 4. Execute DB Update
  const updatedUser = await userModel.updateById(id, updates);
  
  if (!updatedUser) {
    throw { status: 404, message: "user not found or update failed" };
  }

  return { id: updatedUser.id, email: updatedUser.email, role: updatedUser.role };
}

async function getUserStatus(id) {
  if (!id) {
    throw { status: 400, message: "user id is required" };
  }

  const user = await userModel.findById(id);
  if (!user) {
    throw { status: 404, message: "user not found" };
  }

  return { id: user.id, is_active: user.is_active };
}

module.exports = { register, login, verifyToken, deleteUser, updateUser, getUserStatus };