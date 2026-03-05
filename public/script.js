const MARKET_CATEGORIES = [
    "All Categories",
    "Electronics",
    "Vehicles",
    "Property",
    "Fashion",
    "Home & Garden",
    "Services",
    "Other"
];

const MARKET_LOCATIONS = [
    "All Kenya",
    "Nairobi",
    "Mombasa",
    "Kisumu",
    "Nakuru",
    "Eldoret"
];

let listingsCache = [];

function escapeHtml(str) {
    if (!str) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function parsePriceValue(value) {
    const num = Number(String(value || "").replace(/[^\d.]/g, ""));
    return Number.isFinite(num) ? num : 0;
}

function inferCategory(listing) {
    if (listing.category) return listing.category;
    const hay = `${listing.title || ""} ${listing.description || ""}`.toLowerCase();
    if (/(car|vehicle|bike|toyota|nissan)/.test(hay)) return "Vehicles";
    if (/(house|plot|rent|apartment|land)/.test(hay)) return "Property";
    if (/(shoe|shirt|dress|fashion|bag)/.test(hay)) return "Fashion";
    if (/(repair|service|cleaning|design)/.test(hay)) return "Services";
    if (/(sofa|chair|kitchen|furniture|home)/.test(hay)) return "Home & Garden";
    if (/(phone|laptop|tv|electronics|camera)/.test(hay)) return "Electronics";
    return "Other";
}

function getAuthToken() {
    return localStorage.getItem("token") || "";
}

function authHeaders(extra = {}) {
    const token = getAuthToken();
    return {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...extra
    };
}

function setStatus(targetId, message, isError) {
    const el = document.getElementById(targetId);
    if (!el) return;
    el.textContent = message || "";
    el.className = `status ${isError ? "error" : "ok"}`;
}

function requireAuth() {
    if (!getAuthToken()) {
        window.location.href = "login.html";
        return false;
    }
    return true;
}

function logout() {
    localStorage.clear();
    window.location.href = "index.html";
}

function buildProductCard(item) {
    const sellerPhone = item.owner?.contact ? escapeHtml(item.owner.contact) : "Not provided";
    const fallbackEmail = item.owner?.email ? escapeHtml(item.owner.email) : "N/A";
    const contactPlatform = escapeHtml(item.contactPlatform || "Phone");
    return `
        <img src="${item.picture ? escapeHtml(item.picture) : "https://via.placeholder.com/220x160?text=No+Image"}" alt="${escapeHtml(item.title)}">
        <div class="badge-row">
            <span class="badge">${escapeHtml(item.category || inferCategory(item))}</span>
            <span class="badge badge-soft">${escapeHtml(item.location || "All Kenya")}</span>
        </div>
        <h4>${escapeHtml(item.title)}</h4>
        <div class="price">Ksh ${escapeHtml(item.price)}</div>
        <p>${escapeHtml(item.description)}</p>
        <div class="contact">
            <strong>Seller:</strong> ${escapeHtml(item.owner?.name || "Unknown")}<br>
            <strong>Platform:</strong> ${contactPlatform}<br>
            <strong>Phone:</strong> ${sellerPhone}<br>
            <strong>Email:</strong> ${fallbackEmail}
        </div>
    `;
}

function renderListings(containerId, items) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = "";
    if (!Array.isArray(items) || items.length === 0) {
        container.innerHTML = "<p>No listings found for this filter.</p>";
        return;
    }

    items.forEach(item => {
        const card = document.createElement("article");
        card.className = "product-card";
        card.innerHTML = buildProductCard(item);
        container.appendChild(card);
    });
}

function getMarketFilters() {
    const search = document.getElementById("marketSearch")?.value.trim().toLowerCase() || "";
    const category = document.getElementById("marketCategory")?.value || "All Categories";
    const location = document.getElementById("marketLocation")?.value || "All Kenya";
    const minPrice = parsePriceValue(document.getElementById("marketMinPrice")?.value || "");
    const maxPrice = parsePriceValue(document.getElementById("marketMaxPrice")?.value || "");
    const sort = document.getElementById("marketSort")?.value || "newest";
    return { search, category, location, minPrice, maxPrice, sort };
}

function applyFilters(data, filters) {
    let filtered = Array.isArray(data) ? [...data] : [];

    filtered = filtered.filter(item => {
        const title = (item.title || "").toLowerCase();
        const description = (item.description || "").toLowerCase();
        const category = item.category || inferCategory(item);
        const location = item.location || "All Kenya";
        const price = parsePriceValue(item.price);

        const searchMatch = !filters.search || title.includes(filters.search) || description.includes(filters.search);
        const categoryMatch = filters.category === "All Categories" || category === filters.category;
        const locationMatch = filters.location === "All Kenya" || location === filters.location;
        const minMatch = !filters.minPrice || price >= filters.minPrice;
        const maxMatch = !filters.maxPrice || price <= filters.maxPrice;
        return searchMatch && categoryMatch && locationMatch && minMatch && maxMatch;
    });

    if (filters.sort === "price_low") {
        filtered.sort((a, b) => parsePriceValue(a.price) - parsePriceValue(b.price));
    } else if (filters.sort === "price_high") {
        filtered.sort((a, b) => parsePriceValue(b.price) - parsePriceValue(a.price));
    } else {
        filtered.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    }

    return filtered;
}

function syncCategorySidebar(activeCategory) {
    const buttons = document.querySelectorAll(".category-link");
    buttons.forEach(btn => {
        btn.classList.toggle("active", btn.dataset.category === activeCategory);
    });
}

function syncLocationChips(activeLocation) {
    const chips = document.querySelectorAll(".location-chip");
    chips.forEach(chip => {
        chip.classList.toggle("active", chip.dataset.location === activeLocation);
    });
}

function updateMarketView() {
    const listEl = document.getElementById("listings");
    if (!listEl) return;
    const filters = getMarketFilters();
    const filtered = applyFilters(listingsCache, filters);
    renderListings("listings", filtered);

    const count = document.getElementById("resultsCount");
    if (count) count.textContent = `${filtered.length} result${filtered.length === 1 ? "" : "s"}`;
    syncCategorySidebar(filters.category);
    syncLocationChips(filters.location);
}

function initializeMarketplaceUi() {
    const categorySelect = document.getElementById("marketCategory");
    const locationSelect = document.getElementById("marketLocation");
    if (!categorySelect || !locationSelect) return;

    categorySelect.innerHTML = MARKET_CATEGORIES.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
    locationSelect.innerHTML = MARKET_LOCATIONS.map(l => `<option value="${escapeHtml(l)}">${escapeHtml(l)}</option>`).join("");

    document.querySelectorAll(".category-link").forEach(btn => {
        btn.addEventListener("click", () => {
            categorySelect.value = btn.dataset.category;
            updateMarketView();
        });
    });

    document.querySelectorAll(".location-chip").forEach(chip => {
        chip.addEventListener("click", () => {
            locationSelect.value = chip.dataset.location;
            updateMarketView();
        });
    });

    const ids = ["marketSearch", "marketCategory", "marketLocation", "marketMinPrice", "marketMaxPrice", "marketSort"];
    ids.forEach(id => {
        document.getElementById(id)?.addEventListener("input", updateMarketView);
        document.getElementById(id)?.addEventListener("change", updateMarketView);
    });

    document.getElementById("clearFilters")?.addEventListener("click", () => {
        document.getElementById("marketSearch").value = "";
        document.getElementById("marketCategory").value = "All Categories";
        document.getElementById("marketLocation").value = "All Kenya";
        document.getElementById("marketMinPrice").value = "";
        document.getElementById("marketMaxPrice").value = "";
        document.getElementById("marketSort").value = "newest";
        updateMarketView();
    });
}

async function fetchApprovedListings() {
    const res = await fetch("/api/listings");
    const data = await res.json();
    if (!res.ok) throw new Error(data.msg || "Failed to fetch listings");
    listingsCache = Array.isArray(data) ? data.map(item => ({
        ...item,
        category: item.category || inferCategory(item),
        location: item.location || "All Kenya"
    })) : [];
}

async function loadLatestListings() {
    const container = document.getElementById("listings");
    if (!container) return;

    container.innerHTML = "<p>Loading listings...</p>";
    try {
        await fetchApprovedListings();
        if (!listingsCache.length) {
            container.innerHTML = "<p>No listings available.</p>";
            return;
        }
        initializeMarketplaceUi();
        updateMarketView();
    } catch (err) {
        container.innerHTML = `<p>${escapeHtml(err.message || "Failed to load listings.")}</p>`;
    }
}

async function register() {
    const name = document.getElementById("name")?.value.trim() || "";
    const email = document.getElementById("email")?.value.trim() || "";
    const password = document.getElementById("password")?.value || "";
    const contact = document.getElementById("contact")?.value.trim() || "";
    const location = document.getElementById("location")?.value.trim() || "";
    const bio = document.getElementById("bio")?.value.trim() || "";

    if (!name || !email || !password) {
        setStatus("authStatus", "Name, email, and password are required.", true);
        return;
    }

    try {
        const res = await fetch("/api/register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, email, password, contact, location, bio })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.msg || "Registration failed");

        setStatus("authStatus", data.msg || "Registered successfully. Redirecting to login...", false);
        setTimeout(() => {
            window.location.href = "login.html";
        }, 900);
    } catch (err) {
        setStatus("authStatus", err.message || "Registration failed", true);
    }
}

async function loadProfile() {
    if (!requireAuth()) return;
    try {
        const res = await fetch("/api/profile", { headers: authHeaders() });
        const data = await res.json();
        if (!res.ok) throw new Error(data.msg || "Failed to load profile");
        const nameField = document.getElementById("profileName");
        const contactField = document.getElementById("profileContact");
        const locationField = document.getElementById("profileLocation");
        const bioField = document.getElementById("profileBio");
        if (nameField) nameField.value = data.name || "";
        if (contactField) contactField.value = data.contact || "";
        if (locationField) locationField.value = data.profile?.location || "";
        if (bioField) bioField.value = data.profile?.bio || "";
    } catch (err) {
        setStatus("profileStatus", err.message || "Failed to load profile", true);
    }
}

async function saveProfile(event) {
    event.preventDefault();
    if (!requireAuth()) return;
    const name = document.getElementById("profileName")?.value.trim() || "";
    const contact = document.getElementById("profileContact")?.value.trim() || "";
    const location = document.getElementById("profileLocation")?.value.trim() || "";
    const bio = document.getElementById("profileBio")?.value.trim() || "";

    if (!name) {
        setStatus("profileStatus", "Name is required.", true);
        return;
    }

    try {
        const res = await fetch("/api/profile", {
            method: "PUT",
            headers: authHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify({ name, contact, location, bio })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.msg || "Failed to update profile");
        setStatus("profileStatus", data.msg || "Profile updated.", false);
    } catch (err) {
        setStatus("profileStatus", err.message || "Failed to update profile", true);
    }
}

async function login() {
    const email = document.getElementById("loginEmail")?.value.trim() || "";
    const password = document.getElementById("loginPassword")?.value || "";

    if (!email || !password) {
        setStatus("authStatus", "Email and password are required.", true);
        return;
    }

    try {
        const res = await fetch("/api/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        if (!res.ok || !data.token) throw new Error(data.msg || "Login failed");

        localStorage.setItem("token", data.token);
        if (data.user?.role) localStorage.setItem("role", data.user.role);
        window.location.href = data.user?.role === "admin" ? "adminpanel.html" : "dashboard.html";
    } catch (err) {
        setStatus("authStatus", err.message || "Login failed", true);
    }
}

async function submitListing(event) {
    event.preventDefault();
    const form = document.getElementById("listingForm");
    if (!form || !requireAuth()) return;

    const title = document.getElementById("title")?.value.trim() || "";
    const price = document.getElementById("price")?.value.trim() || "";
    const description = document.getElementById("description")?.value.trim() || "";
    const category = document.getElementById("category")?.value || "Other";
    const location = document.getElementById("location")?.value.trim() || "All Kenya";
    const contactPlatform = document.getElementById("contactPlatform")?.value || "Phone";
    const picture = document.getElementById("picture")?.files?.[0];

    if (!title || !price || !description) {
        setStatus("listingStatus", "Title, price, and description are required.", true);
        return;
    }

    const formData = new FormData();
    formData.append("title", title);
    formData.append("price", price);
    formData.append("description", description);
    formData.append("category", category);
    formData.append("location", location);
    formData.append("contactPlatform", contactPlatform);
    if (picture) formData.append("picture", picture);

    try {
        const res = await fetch("/api/listing", {
            method: "POST",
            headers: authHeaders(),
            body: formData
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.msg || "Failed to submit listing");

        setStatus("listingStatus", data.msg || "Listing submitted for approval.", false);
        form.reset();
    } catch (err) {
        setStatus("listingStatus", err.message || "Failed to submit listing", true);
    }
}

async function search() {
    const q = document.getElementById("searchBox")?.value.trim().toLowerCase() || "";
    const category = document.getElementById("searchCategory")?.value || "All Categories";
    const location = document.getElementById("searchLocation")?.value || "All Kenya";
    const results = document.getElementById("results");
    if (!results) return;

    results.innerHTML = "<p>Searching...</p>";
    try {
        await fetchApprovedListings();
        const filtered = applyFilters(listingsCache, {
            search: q,
            category,
            location,
            minPrice: 0,
            maxPrice: 0,
            sort: "newest"
        });

        renderListings("results", filtered);
        const searchCount = document.getElementById("searchCount");
        if (searchCount) searchCount.textContent = `${filtered.length} result${filtered.length === 1 ? "" : "s"}`;
    } catch (err) {
        results.innerHTML = `<p>${escapeHtml(err.message || "Search failed.")}</p>`;
    }
}

async function loadPendingListings() {
    const container = document.getElementById("pending");
    if (!container) return;
    if (!requireAuth()) return;

    const role = localStorage.getItem("role");
    if (role !== "admin") {
        container.innerHTML = "<p>Admin access required.</p>";
        return;
    }

    container.innerHTML = "<p>Loading pending listings...</p>";
    try {
        const res = await fetch("/api/admin/pending", {
            headers: authHeaders()
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.msg || "Failed to fetch pending listings");

        container.innerHTML = "";
        if (!Array.isArray(data) || data.length === 0) {
            container.innerHTML = "<p>No pending listings.</p>";
            return;
        }

        data.forEach(item => {
            const card = document.createElement("article");
            card.className = "card";
            card.innerHTML = `
                <h4>${escapeHtml(item.title)}</h4>
                <p>${escapeHtml(item.description)}</p>
                <p><strong>Ksh ${escapeHtml(item.price)}</strong></p>
                <p><strong>Category:</strong> ${escapeHtml(item.category || "Other")} | <strong>Location:</strong> ${escapeHtml(item.location || "All Kenya")}</p>
                <p><strong>Contact Platform:</strong> ${escapeHtml(item.contactPlatform || "Phone")}</p>
                <p>Owner: ${escapeHtml(item.owner?.name || "Unknown")} | Phone: ${escapeHtml(item.owner?.contact || "N/A")} | Email: ${escapeHtml(item.owner?.email || "N/A")}</p>
                <div class="row-actions">
                    <button data-action="approve" data-id="${escapeHtml(item._id)}">Approve</button>
                    <button class="btn-danger" data-action="reject" data-id="${escapeHtml(item._id)}">Reject</button>
                </div>
            `;
            container.appendChild(card);
        });
    } catch (err) {
        container.innerHTML = `<p>${escapeHtml(err.message || "Failed to load pending listings.")}</p>`;
    }
}

async function moderateListing(id, action) {
    const endpoint = action === "approve" ? "/api/admin/approve" : "/api/admin/reject";
    try {
        const res = await fetch(endpoint, {
            method: "POST",
            headers: authHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify({ id })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.msg || `Failed to ${action} listing`);
        setStatus("adminStatus", data.msg || `Listing ${action}d`, false);
        await loadPendingListings();
    } catch (err) {
        setStatus("adminStatus", err.message || `Failed to ${action} listing`, true);
    }
}

document.addEventListener("DOMContentLoaded", () => {
    loadLatestListings();

    const registerForm = document.getElementById("registerForm");
    if (registerForm) {
        registerForm.addEventListener("submit", (e) => {
            e.preventDefault();
            register();
        });
    }

    const loginForm = document.getElementById("loginForm");
    if (loginForm) {
        loginForm.addEventListener("submit", (e) => {
            e.preventDefault();
            login();
        });
    }

    const listingForm = document.getElementById("listingForm");
    if (listingForm) {
        requireAuth();
        listingForm.addEventListener("submit", submitListing);
    }

    const profileForm = document.getElementById("profileForm");
    if (profileForm) {
        requireAuth();
        loadProfile();
        profileForm.addEventListener("submit", saveProfile);
    }

    ["searchBox", "searchCategory", "searchLocation"].forEach(id => {
        document.getElementById(id)?.addEventListener("change", search);
        document.getElementById(id)?.addEventListener("input", search);
    });

    const searchBox = document.getElementById("searchBox");
    if (searchBox) {
        searchBox.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                search();
            }
        });
    }

    const categoryField = document.getElementById("category");
    if (categoryField) {
        categoryField.innerHTML = MARKET_CATEGORIES.filter(c => c !== "All Categories")
            .map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`)
            .join("");
    }

    const locationField = document.getElementById("location");
    if (locationField) {
        locationField.setAttribute("list", "listingLocations");
        const dataList = document.createElement("datalist");
        dataList.id = "listingLocations";
        dataList.innerHTML = MARKET_LOCATIONS.filter(l => l !== "All Kenya")
            .map(l => `<option value="${escapeHtml(l)}"></option>`)
            .join("");
        document.body.appendChild(dataList);
    }

    const searchCategory = document.getElementById("searchCategory");
    if (searchCategory) {
        searchCategory.innerHTML = MARKET_CATEGORIES.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
    }

    const searchLocation = document.getElementById("searchLocation");
    if (searchLocation) {
        searchLocation.innerHTML = MARKET_LOCATIONS.map(l => `<option value="${escapeHtml(l)}">${escapeHtml(l)}</option>`).join("");
    }

    const pending = document.getElementById("pending");
    if (pending) {
        loadPendingListings();
        pending.addEventListener("click", (e) => {
            const btn = e.target.closest("button[data-action]");
            if (!btn) return;
            moderateListing(btn.dataset.id, btn.dataset.action);
        });
    }
});
