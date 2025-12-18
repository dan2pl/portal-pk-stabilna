// scripts/create-test-account.js
const nodemailer = require("nodemailer");

(async () => {
  try {
    const testAccount = await nodemailer.createTestAccount();

    console.log("=== ETHEREAL TEST ACCOUNT ===");
    console.log("SMTP host:", testAccount.smtp.host);
    console.log("SMTP port:", testAccount.smtp.port);
    console.log("SMTP secure:", testAccount.smtp.secure);
    console.log("user:", testAccount.user);
    console.log("pass:", testAccount.pass);
    console.log("\nWeb panel (podgląd maili):", testAccount.web);
  } catch (err) {
    console.error("Error creating test account:", err);
  }
})();