// This file just maps "URL + HTTP method" to "which controller function
// handles it." Nothing else. If you're looking for actual logic, it's not
// here — check the controller, or the service if it's business logic.

const express = require("express");
const authController = require("../controllers/auth.controller");

// express.Router() creates a mini, self-contained set of routes that we
// can mount onto our main app under a prefix (done in index.js, as "/auth").
const router = express.Router();

router.post("/register", authController.register);
router.post("/login", authController.login);
router.post("/verify", authController.verify);

module.exports = router;
