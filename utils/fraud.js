function computeListingRiskScore({ listing, seller }) {
    let score = 0;
    const flags = [];

    const price = Number(listing && listing.price ? listing.price : 0);
    const reportsCount = Number(listing && listing.reportsCount ? listing.reportsCount : 0);
    const sellerVerified = !!(seller && seller.verifiedSeller);
    const sellerCreatedAt = seller && seller.createdAt ? new Date(seller.createdAt).getTime() : 0;
    const sellerAgeDays =
        sellerCreatedAt > 0 ? (Date.now() - sellerCreatedAt) / (1000 * 60 * 60 * 24) : 9999;

    if (!sellerVerified) {
        score += 12;
        flags.push("unverified_seller");
    }

    if (sellerAgeDays < 14) {
        score += 18;
        flags.push("new_seller_account");
    }

    if (price >= 200000) {
        score += 18;
        flags.push("high_price");
    } else if (price >= 100000) {
        score += 10;
        flags.push("mid_high_price");
    }

    if (reportsCount > 0) {
        score += reportsCount * 14;
        flags.push("reported_listing");
    }

    if (!listing || !listing.contactPhone) {
        score += 8;
        flags.push("missing_phone");
    }

    if (String(listing && listing.category ? listing.category : "").toLowerCase() === "services") {
        score += 4;
        flags.push("service_category");
    }

    const normalizedScore = Math.max(0, Math.min(100, Math.round(score)));
    const riskLevel =
        normalizedScore >= 70 ? "high" : normalizedScore >= 40 ? "medium" : "low";

    return {
        score: normalizedScore,
        flags,
        riskLevel
    };
}

module.exports = {
    computeListingRiskScore
};
