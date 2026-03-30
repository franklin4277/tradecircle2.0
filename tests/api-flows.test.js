const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const request = require("supertest");
const { MongoMemoryServer } = require("mongodb-memory-server");

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "tradecircle-test-jwt-secret-12345";
process.env.ADMIN_REGISTER_SECRET = "test-admin-secret";
process.env.ALLOW_ADMIN_REGISTRATION = "true";
process.env.CORS_ORIGIN = "http://localhost:5000";

const { app } = require("../server");

let mongoServer;

test.before(async () => {
    mongoServer = await MongoMemoryServer.create({
        instance: {
            launchTimeout: 120000
        }
    });
    await mongoose.connect(mongoServer.getUri());
});

test.after(async () => {
    await mongoose.disconnect();
    if (mongoServer) {
        await mongoServer.stop();
    }
});

test.beforeEach(async () => {
    if (mongoose.connection && mongoose.connection.db) {
        await mongoose.connection.db.dropDatabase();
    }
});

test("critical flows: auth, listing creation, moderation, messaging inbox, report", async () => {
    const sellerRegister = await request(app)
        .post("/api/auth/register")
        .send({
            name: "Seller One",
            email: "seller@example.com",
            password: "password123",
            phoneNumber: "0712345678",
            city: "Nairobi"
        })
        .expect(201);

    assert.ok(sellerRegister.body.token);
    const sellerToken = sellerRegister.body.token;
    const sellerId = sellerRegister.body.user && sellerRegister.body.user._id;
    assert.ok(sellerId);

    const sellerLogin = await request(app)
        .post("/api/auth/login")
        .send({
            email: "seller@example.com",
            password: "password123"
        })
        .expect(200);
    assert.ok(sellerLogin.body.token);

    await request(app)
        .post("/api/listings")
        .set("Authorization", `Bearer ${sellerToken}`)
        .send({
            title: "Blocked draft",
            description: "This should fail before community verification is approved.",
            price: 1000,
            location: "Nairobi",
            category: "Electronics",
            itemCondition: "Used - Good",
            contactPhone: "0712345678",
            negotiable: true,
            deliveryAvailable: false,
            meetupAvailable: true
        })
        .expect(403);

    const adminRegister = await request(app)
        .post("/api/auth/register")
        .send({
            name: "Admin User",
            email: "admin@example.com",
            password: "password1234",
            adminSecret: "test-admin-secret"
        })
        .expect(201);
    assert.equal(adminRegister.body.user.role, "admin");
    const adminToken = adminRegister.body.token;

    await request(app)
        .patch(`/api/admin/users/${sellerId}/verify`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ communityVerified: true })
        .expect(200);

    const listingCreate = await request(app)
        .post("/api/listings")
        .set("Authorization", `Bearer ${sellerToken}`)
        .send({
            title: "iPhone 13 128GB",
            description: "Used carefully for one year. Comes with box and charger.",
            price: 72000,
            location: "Nairobi",
            category: "Electronics",
            itemCondition: "Used - Good",
            contactPhone: "0712345678",
            negotiable: true,
            deliveryAvailable: true,
            meetupAvailable: true
        })
        .expect(201);

    const listingId = listingCreate.body.listing && listingCreate.body.listing._id;
    assert.ok(listingId);

    const moderatorRegister = await request(app)
        .post("/api/auth/register")
        .send({
            name: "Moderator One",
            email: "moderator@example.com",
            password: "password123",
            phoneNumber: "0700000003",
            city: "Nairobi"
        })
        .expect(201);
    const moderatorToken = moderatorRegister.body.token;
    const moderatorId = moderatorRegister.body.user && moderatorRegister.body.user._id;
    assert.ok(moderatorId);

    await request(app)
        .patch(`/api/admin/users/${moderatorId}/role`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ role: "moderator" })
        .expect(200);

    const listingForRemoval = await request(app)
        .post("/api/listings")
        .set("Authorization", `Bearer ${sellerToken}`)
        .send({
            title: "Old Listing To Remove",
            description: "Temporary listing to verify moderator removal action works.",
            price: 5000,
            location: "Nakuru",
            category: "Electronics",
            itemCondition: "Used - Good",
            contactPhone: "0712345678",
            negotiable: true,
            deliveryAvailable: false,
            meetupAvailable: true
        })
        .expect(201);

    const listingRemovalId = listingForRemoval.body.listing && listingForRemoval.body.listing._id;
    assert.ok(listingRemovalId);

    await request(app)
        .delete(`/api/listings/${listingRemovalId}`)
        .set("Authorization", `Bearer ${moderatorToken}`)
        .expect(200);

    await request(app)
        .patch(`/api/admin/listings/${listingId}/status`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ status: "approved" })
        .expect(200);

    const buyerRegister = await request(app)
        .post("/api/auth/register")
        .send({
            name: "Buyer One",
            email: "buyer@example.com",
            password: "password123",
            phoneNumber: "0700000001",
            city: "Mombasa"
        })
        .expect(201);
    const buyerToken = buyerRegister.body.token;
    const buyerId = buyerRegister.body.user && buyerRegister.body.user._id;
    assert.ok(buyerId);

    await request(app)
        .patch(`/api/admin/users/${buyerId}/verify`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ communityVerified: true })
        .expect(200);

    await request(app)
        .post("/api/escrow/wallet/topup")
        .set("Authorization", `Bearer ${buyerToken}`)
        .send({ amount: 100000 })
        .expect(201);

    const unverifiedBuyerRegister = await request(app)
        .post("/api/auth/register")
        .send({
            name: "Buyer Pending",
            email: "buyer-pending@example.com",
            password: "password123",
            phoneNumber: "0700000002",
            city: "Kisumu"
        })
        .expect(201);
    const unverifiedBuyerToken = unverifiedBuyerRegister.body.token;

    await request(app)
        .post(`/api/listings/${listingId}/messages`)
        .set("Authorization", `Bearer ${unverifiedBuyerToken}`)
        .send({
            message: "Trying to message before verification."
        })
        .expect(403);

    await request(app)
        .post(`/api/listings/${listingId}/messages`)
        .set("Authorization", `Bearer ${buyerToken}`)
        .send({
            message: "Hi, is this phone still available?"
        })
        .expect(201);

    const inboxBeforeRead = await request(app)
        .get("/api/listings/inbox")
        .set("Authorization", `Bearer ${sellerToken}`)
        .expect(200);
    assert.equal(inboxBeforeRead.body.unreadTotal, 1);
    assert.equal(inboxBeforeRead.body.threads.length, 1);

    const sellerMessages = await request(app)
        .get(`/api/listings/${listingId}/messages`)
        .set("Authorization", `Bearer ${sellerToken}`)
        .expect(200);
    assert.ok(Array.isArray(sellerMessages.body.messages));
    assert.equal(sellerMessages.body.messages[0].senderName, "Buyer One");
    assert.equal(sellerMessages.body.messages[0].senderEmail, "buyer@example.com");

    const inboxAfterRead = await request(app)
        .get("/api/listings/inbox")
        .set("Authorization", `Bearer ${sellerToken}`)
        .expect(200);
    assert.equal(inboxAfterRead.body.unreadTotal, 0);

    const reportResponse = await request(app)
        .post(`/api/listings/${listingId}/report`)
        .set("Authorization", `Bearer ${buyerToken}`)
        .send({
            reason: "Scam",
            notes: "Suspicious pricing. Please review."
        })
        .expect(201);
    assert.equal(reportResponse.body.reportsCount, 1);

    const escrowStart = await request(app)
        .post("/api/escrow/start")
        .set("Authorization", `Bearer ${buyerToken}`)
        .send({
            listingId,
            amount: 70000,
            note: "Will confirm once phone is delivered."
        })
        .expect(201);
    assert.equal(escrowStart.body.escrow.status, "funded");
    const escrowId = escrowStart.body.escrow && escrowStart.body.escrow._id;
    assert.ok(escrowId);

    const sellerShip = await request(app)
        .patch(`/api/escrow/${escrowId}/ship`)
        .set("Authorization", `Bearer ${sellerToken}`)
        .expect(200);
    assert.equal(sellerShip.body.escrow.status, "shipped");

    const buyerConfirm = await request(app)
        .patch(`/api/escrow/${escrowId}/confirm`)
        .set("Authorization", `Bearer ${buyerToken}`)
        .expect(200);
    assert.equal(buyerConfirm.body.escrow.status, "released");
    assert.equal(buyerConfirm.body.buyerWallet.held, 0);
    assert.equal(buyerConfirm.body.sellerWallet.available, 70000);

    const sellerListingsAfterRelease = await request(app)
        .get("/api/listings/mine")
        .set("Authorization", `Bearer ${sellerToken}`)
        .expect(200);
    assert.equal(sellerListingsAfterRelease.body.listings[0].availability, "sold");

    const sellerProfileAfterRelease = await request(app)
        .get("/api/auth/me")
        .set("Authorization", `Bearer ${sellerToken}`)
        .expect(200);
    assert.equal(sellerProfileAfterRelease.body.user.walletBalance, 70000);
});
