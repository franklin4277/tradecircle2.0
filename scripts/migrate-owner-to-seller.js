require("dotenv").config();

const mongoose = require("mongoose");
const Listing = require("../models/listing");

async function runMigration() {
    const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!mongoUri) {
        throw new Error("Missing MONGO_URI or MONGODB_URI in environment.");
    }

    await mongoose.connect(mongoUri);

    const query = {
        $or: [
            { seller: { $exists: false } },
            { seller: null },
            { owner: { $exists: false } },
            { owner: null },
            { contactPhone: { $exists: false } },
            { contactPhone: null },
            { contactPhone: "" }
        ]
    };

    const listings = await Listing.find(query).select("_id seller owner contactPhone");

    if (listings.length === 0) {
        // eslint-disable-next-line no-console
        console.log("No legacy listings need migration.");
        await mongoose.disconnect();
        return;
    }

    const operations = [];
    for (const listing of listings) {
        const update = {};

        if (!listing.seller && listing.owner) {
            update.seller = listing.owner;
        }

        if (!listing.owner && listing.seller) {
            update.owner = listing.seller;
        }

        if (!listing.contactPhone) {
            // Placeholder allows old records to pass new validation rules.
            update.contactPhone = "0000000000";
        }

        if (Object.keys(update).length > 0) {
            operations.push({
                updateOne: {
                    filter: { _id: listing._id },
                    update: { $set: update }
                }
            });
        }
    }

    if (operations.length > 0) {
        const result = await Listing.bulkWrite(operations);
        // eslint-disable-next-line no-console
        console.log(
            `Migration complete. Matched ${result.matchedCount}, modified ${result.modifiedCount} listings.`
        );
    } else {
        // eslint-disable-next-line no-console
        console.log("No listing fields required updates after analysis.");
    }

    await mongoose.disconnect();
}

runMigration()
    .then(() => process.exit(0))
    .catch(async (error) => {
        // eslint-disable-next-line no-console
        console.error("Migration failed:", error.message);
        try {
            await mongoose.disconnect();
        } catch {
            // ignore cleanup error
        }
        process.exit(1);
    });
