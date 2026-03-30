const WalletTransaction = require("../models/walletTransaction");

function roundMoney(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount)) {
        return 0;
    }
    return Number(amount.toFixed(2));
}

async function recordWalletTransaction({
    userId,
    type,
    amount,
    balanceAfter,
    referenceType = "system",
    referenceId = "",
    note = ""
}) {
    return WalletTransaction.create({
        user: userId,
        type,
        amount: roundMoney(amount),
        balanceAfter: roundMoney(balanceAfter),
        referenceType,
        referenceId: String(referenceId || ""),
        note: String(note || "").trim()
    });
}

module.exports = {
    roundMoney,
    recordWalletTransaction
};
