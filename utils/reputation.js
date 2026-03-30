const User = require("../models/user");

async function adjustReputation(userId, delta) {
    const user = await User.findById(userId).select("reputationScore");
    if (!user) {
        return null;
    }

    user.reputationScore = Math.max(0, Math.min(1000, user.reputationScore + delta));
    await user.save();

    return user.reputationScore;
}

module.exports = {
    adjustReputation
};
