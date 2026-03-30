
(() => {
    const API_BASE = "/api";
    const TOKEN_KEY = "tradecircle_token";
    const USER_CACHE_KEY = "tradecircle_user_cache";
    const FALLBACK_CATEGORIES = [
        "Electronics",
        "Vehicles",
        "Property",
        "Home & Furniture",
        "Fashion",
        "Jobs",
        "Services",
        "Agriculture",
        "Other"
    ];
    const FALLBACK_CONDITIONS = ["Brand New", "Like New", "Used - Good", "Used - Fair", "Refurbished"];
    const state = {
        user: null,
        toastTimer: null,
        meta: null
    };

    document.addEventListener("DOMContentLoaded", async () => {
        const page = document.body.dataset.page || "index";

        await hydrateCurrentUser();
        setupNavigation(page);
        setupAutoHidingHeader();

        try {
            if (page === "index") {
                await initIndexPage();
            }

            if (page === "login") {
                initLoginPage();
            }

            if (page === "register") {
                initRegisterPage();
            }

            if (page === "dashboard") {
                await initDashboardPage();
            }

            if (page === "admin") {
                await initAdminPage();
            }
        } catch (error) {
            showToast(error.message || "Unable to load this page right now.", "error");
        }
    });

    function setupAutoHidingHeader() {
        const navbar = document.querySelector(".navbar");
        if (!navbar) {
            return;
        }

        let lastScrollY = window.scrollY || 0;
        let ticking = false;

        window.addEventListener(
            "scroll",
            () => {
                if (ticking) {
                    return;
                }

                ticking = true;
                window.requestAnimationFrame(() => {
                    const currentY = window.scrollY || 0;
                    const scrollingDown = currentY > lastScrollY;

                    if (scrollingDown && currentY > 80) {
                        navbar.classList.add("navbar-hidden");
                    } else {
                        navbar.classList.remove("navbar-hidden");
                    }

                    lastScrollY = currentY;
                    ticking = false;
                });
            },
            { passive: true }
        );
    }

    function getToken() {
        return localStorage.getItem(TOKEN_KEY);
    }

    function setSession(token, user) {
        localStorage.setItem(TOKEN_KEY, token);
        localStorage.setItem(USER_CACHE_KEY, JSON.stringify(user));
        state.user = user;
    }

    function clearSession() {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_CACHE_KEY);
        state.user = null;
    }

    function getCachedUser() {
        try {
            return JSON.parse(localStorage.getItem(USER_CACHE_KEY) || "null");
        } catch {
            return null;
        }
    }

    async function hydrateCurrentUser() {
        const token = getToken();

        if (!token) {
            state.user = getCachedUser();
            return;
        }

        try {
            const data = await apiRequest("/auth/me", {}, true);
            state.user = data.user;
            localStorage.setItem(USER_CACHE_KEY, JSON.stringify(data.user));
        } catch {
            clearSession();
        }
    }

    function setupNavigation(page) {
        const navSearchForm = document.getElementById("navSearchForm");
        const navSearchInput = document.getElementById("navSearchInput");
        const authLinks = document.getElementById("authLinks");

        if (navSearchForm) {
            if (page !== "index") {
                navSearchForm.classList.add("hidden");
            }

            const params = new URLSearchParams(window.location.search);
            if (navSearchInput && params.get("search")) {
                navSearchInput.value = params.get("search");
            }

            navSearchForm.addEventListener("submit", (event) => {
                event.preventDefault();
                const query = navSearchInput ? navSearchInput.value.trim() : "";
                const destination = new URL("index.html", window.location.href);

                if (query) {
                    destination.searchParams.set("search", query);
                }

                window.location.href = `${destination.pathname}${destination.search}`;
            });
        }

        if (!authLinks) {
            return;
        }

        const items = ["<a class=\"btn btn-link\" href=\"index.html\">Home</a>"];

        if (!state.user) {
            items.push("<a class=\"btn btn-link\" href=\"login.html\">Login</a>");
            items.push("<a class=\"btn btn-primary\" href=\"register.html\">Register</a>");
        } else {
            items.push("<a class=\"btn btn-link\" href=\"dashboard.html\">Dashboard</a>");

            if (state.user.role === "admin" || state.user.role === "moderator") {
                items.push("<a class=\"btn btn-link\" href=\"admin.html\">Admin</a>");
            }

            items.push("<button id=\"logoutBtn\" class=\"btn btn-secondary\" type=\"button\">Logout</button>");
        }

        authLinks.innerHTML = items.join("");

        const logoutBtn = document.getElementById("logoutBtn");
        if (logoutBtn) {
            logoutBtn.addEventListener("click", () => {
                clearSession();
                showToast("You have been logged out.", "success");
                setTimeout(() => {
                    window.location.href = "index.html";
                }, 350);
            });
        }
    }

    function showToast(message, type = "info") {
        const toast = document.getElementById("toast");
        if (!toast) {
            return;
        }

        toast.textContent = message;

        if (type === "error") {
            toast.style.background = "#9e1d36";
        } else if (type === "success") {
            toast.style.background = "#157343";
        } else {
            toast.style.background = "#123869";
        }

        toast.classList.add("show");
        clearTimeout(state.toastTimer);
        state.toastTimer = setTimeout(() => {
            toast.classList.remove("show");
        }, 3200);
    }

    async function apiRequest(endpoint, options = {}, requiresAuth = false) {
        const config = {
            method: options.method || "GET",
            headers: {}
        };

        if (requiresAuth) {
            const token = getToken();
            if (!token) {
                throw new Error("Please login to continue.");
            }
            config.headers.Authorization = `Bearer ${token}`;
        }

        if (options.body instanceof FormData) {
            config.body = options.body;
        } else if (options.body !== undefined) {
            config.headers["Content-Type"] = "application/json";
            config.body = JSON.stringify(options.body);
        }

        const response = await fetch(`${API_BASE}${endpoint}`, config);
        const contentType = response.headers.get("content-type") || "";

        let payload = {};
        if (contentType.includes("application/json")) {
            payload = await response.json();
        }

        if (!response.ok) {
            throw new Error(payload.message || `Request failed (${response.status}).`);
        }

        return payload;
    }

    function escapeHtml(value) {
        return String(value || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/\"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function truncate(value, maxLength) {
        const text = String(value || "");
        return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
    }

    function formatCurrency(value) {
        const amount = Number(value || 0);
        return new Intl.NumberFormat("en-KE", {
            style: "currency",
            currency: "KES",
            maximumFractionDigits: 2
        }).format(amount);
    }

    function formatDate(value) {
        if (!value) {
            return "N/A";
        }

        try {
            return new Date(value).toLocaleDateString("en-KE", {
                year: "numeric",
                month: "short",
                day: "numeric"
            });
        } catch {
            return "N/A";
        }
    }

    function formatRelativeTime(value) {
        if (!value) {
            return "recently";
        }

        const timestamp = new Date(value).getTime();
        if (Number.isNaN(timestamp)) {
            return "recently";
        }

        const elapsed = Date.now() - timestamp;
        const minutes = Math.floor(elapsed / (1000 * 60));
        if (minutes < 1) {
            return "just now";
        }
        if (minutes < 60) {
            return `${minutes} min ago`;
        }

        const hours = Math.floor(minutes / 60);
        if (hours < 24) {
            return `${hours} hr ago`;
        }

        const days = Math.floor(hours / 24);
        if (days < 30) {
            return `${days} day${days === 1 ? "" : "s"} ago`;
        }

        const months = Math.floor(days / 30);
        return `${months} month${months === 1 ? "" : "s"} ago`;
    }

    function formatPhone(value) {
        const trimmed = String(value || "").trim();
        if (!trimmed) {
            return "Not provided";
        }

        return trimmed;
    }

    function getStatusClass(status) {
        if (status === "approved") {
            return "badge-approved";
        }

        if (status === "rejected") {
            return "badge-rejected";
        }

        return "badge-pending";
    }

    function normalizeReason(input) {
        const raw = String(input || "").trim().toLowerCase();

        if (raw === "scam") {
            return "Scam";
        }

        if (raw === "fake product" || raw === "fake" || raw === "counterfeit") {
            return "Fake Product";
        }

        if (raw === "abusive content" || raw === "abusive" || raw === "abuse") {
            return "Abusive Content";
        }

        if (raw === "spam") {
            return "Spam";
        }

        if (raw === "other") {
            return "Other";
        }

        return "";
    }

    function redirectByRole(user) {
        if (!user) {
            window.location.href = "index.html";
            return;
        }

        if (user.role === "admin" || user.role === "moderator") {
            window.location.href = "admin.html";
            return;
        }

        window.location.href = "dashboard.html";
    }

    function ensureAuthenticated() {
        if (!state.user || !getToken()) {
            window.location.href = "login.html";
            return false;
        }

        return true;
    }

    function canCurrentUserTrade() {
        if (!state.user) {
            return false;
        }

        if (["admin", "moderator"].includes(state.user.role)) {
            return true;
        }

        return !!state.user.communityVerified;
    }

    async function initIndexPage() {
        const searchInput = document.getElementById("searchInput");
        const locationFilter = document.getElementById("locationFilter");
        const categoryFilter = document.getElementById("categoryFilter");
        const conditionFilter = document.getElementById("conditionFilter");
        const minPriceFilter = document.getElementById("minPriceFilter");
        const maxPriceFilter = document.getElementById("maxPriceFilter");
        const sortFilter = document.getElementById("sortFilter");
        const listingFilterForm = document.getElementById("listingFilterForm");
        const listingGrid = document.getElementById("listingGrid");

        if (
            !searchInput ||
            !locationFilter ||
            !categoryFilter ||
            !conditionFilter ||
            !minPriceFilter ||
            !maxPriceFilter ||
            !sortFilter ||
            !listingFilterForm ||
            !listingGrid
        ) {
            return;
        }

        const params = new URLSearchParams(window.location.search);
        if (params.get("search")) {
            searchInput.value = params.get("search");
        }

        if (params.get("location")) {
            locationFilter.value = params.get("location");
        }

        if (params.get("category")) {
            categoryFilter.value = params.get("category");
        }

        if (params.get("condition")) {
            conditionFilter.value = params.get("condition");
        }

        if (params.get("minPrice")) {
            minPriceFilter.value = params.get("minPrice");
        }

        if (params.get("maxPrice")) {
            maxPriceFilter.value = params.get("maxPrice");
        }

        if (params.get("sort")) {
            sortFilter.value = params.get("sort");
        }

        await loadMarketplaceMeta({
            locationFilter,
            categoryFilter,
            conditionFilter
        });

        if (params.get("location")) {
            locationFilter.value = params.get("location");
        }
        if (params.get("category")) {
            categoryFilter.value = params.get("category");
        }
        if (params.get("condition")) {
            conditionFilter.value = params.get("condition");
        }

        await fetchAndRenderListings({
            searchInput,
            locationFilter,
            categoryFilter,
            conditionFilter,
            minPriceFilter,
            maxPriceFilter,
            sortFilter,
            listingGrid,
            syncUrl: false
        });

        listingFilterForm.addEventListener("submit", async (event) => {
            event.preventDefault();
            try {
                await fetchAndRenderListings({
                    searchInput,
                    locationFilter,
                    categoryFilter,
                    conditionFilter,
                    minPriceFilter,
                    maxPriceFilter,
                    sortFilter,
                    listingGrid,
                    syncUrl: true
                });
            } catch (error) {
                showToast(error.message || "Unable to apply filters.", "error");
            }
        });

        listingGrid.addEventListener("click", async (event) => {
            const button = event.target.closest("button[data-action]");
            if (!button) {
                return;
            }

            const listingId = button.dataset.id;
            const action = button.dataset.action;

            if (!listingId || !action) {
                return;
            }

            try {
                if (action === "report") {
                    await reportListing(listingId);
                }

                if (action === "message") {
                    await sendMessage(listingId);
                }

                if (action === "offer") {
                    await sendOffer(listingId);
                }
            } catch (error) {
                showToast(error.message || "Action failed.", "error");
            }
        });
    }

    async function loadMarketplaceMeta({ locationFilter, categoryFilter, conditionFilter }) {
        let data = null;
        try {
            data = await apiRequest("/listings/meta");
        } catch {
            // Keep UI usable even if meta loading fails.
        }

        const categories = Array.isArray(data && data.categories) ? data.categories : FALLBACK_CATEGORIES;
        const conditions = Array.isArray(data && data.conditions) ? data.conditions : FALLBACK_CONDITIONS;
        const locations = Array.isArray(data && data.locations) ? data.locations : [];

        state.meta = {
            categories,
            conditions,
            locations
        };

        for (const location of locations) {
            const option = document.createElement("option");
            option.value = location;
            option.textContent = location;
            locationFilter.appendChild(option);
        }

        for (const category of categories) {
            const option = document.createElement("option");
            option.value = category;
            option.textContent = category;
            categoryFilter.appendChild(option);
        }

        for (const condition of conditions) {
            const option = document.createElement("option");
            option.value = condition;
            option.textContent = condition;
            conditionFilter.appendChild(option);
        }
    }

    async function fetchAndRenderListings({
        searchInput,
        locationFilter,
        categoryFilter,
        conditionFilter,
        minPriceFilter,
        maxPriceFilter,
        sortFilter,
        listingGrid,
        syncUrl
    }) {
        const params = new URLSearchParams();
        const search = searchInput.value.trim();
        const location = locationFilter.value.trim();
        const category = categoryFilter.value.trim();
        const condition = conditionFilter.value.trim();
        const minPrice = minPriceFilter.value.trim();
        const maxPrice = maxPriceFilter.value.trim();
        const sort = sortFilter.value.trim();

        if (minPrice && maxPrice && Number(minPrice) > Number(maxPrice)) {
            throw new Error("Minimum price cannot be greater than maximum price.");
        }

        if (search) {
            params.set("search", search);
        }

        if (location) {
            params.set("location", location);
        }

        if (category) {
            params.set("category", category);
        }

        if (condition) {
            params.set("condition", condition);
        }

        if (minPrice) {
            params.set("minPrice", minPrice);
        }

        if (maxPrice) {
            params.set("maxPrice", maxPrice);
        }

        if (sort) {
            params.set("sort", sort);
        }

        if (syncUrl) {
            const url = new URL(window.location.href);
            url.search = params.toString();
            window.history.replaceState({}, "", url.toString());
        }

        listingGrid.innerHTML = "<p class=\"empty-state\">Loading listings...</p>";

        const endpoint = params.toString() ? `/listings?${params.toString()}` : "/listings";
        const data = await apiRequest(endpoint);
        const listings = Array.isArray(data.listings) ? data.listings : [];

        renderPublicListings(listingGrid, listings);
    }

    function renderPublicListings(container, listings) {
        if (!listings.length) {
            container.innerHTML = "<p class=\"empty-state\">No approved listings found yet.</p>";
            return;
        }

        container.innerHTML = "";
        const fragment = document.createDocumentFragment();

        for (const listing of listings) {
            fragment.appendChild(buildPublicListingCard(listing));
        }

        container.appendChild(fragment);
    }

    function buildPublicListingCard(listing) {
        const card = document.createElement("article");
        card.className = "listing-card";

        const sellerName = listing.seller && listing.seller.name ? listing.seller.name : "Seller";
        const sellerRep =
            listing.seller && typeof listing.seller.reputationScore === "number"
                ? listing.seller.reputationScore
                : "N/A";

        const sellerId = listing.seller && (listing.seller._id || listing.seller);
        const isOwner = !!(state.user && sellerId && String(sellerId) === String(state.user._id));
        const sellerVerified = !!(listing.seller && listing.seller.verifiedSeller);
        const canTrade = canCurrentUserTrade();

        const chips = [
            `<span class="chip">${escapeHtml(listing.category || "Other")}</span>`,
            `<span class="chip">${escapeHtml(listing.itemCondition || "Used")}</span>`
        ];
        if (listing.negotiable) {
            chips.push("<span class=\"chip\">Negotiable</span>");
        }
        if (listing.deliveryAvailable) {
            chips.push("<span class=\"chip\">Delivery</span>");
        }
        if (listing.availability === "reserved") {
            chips.push("<span class=\"chip chip-warning\">Reserved</span>");
        }
        if (listing.availability === "sold") {
            chips.push("<span class=\"chip chip-sold\">Sold</span>");
        }
        if (sellerVerified) {
            chips.push("<span class=\"chip chip-verified\">Verified Seller</span>");
        }

        let actionHtml = "<p class=\"card-hint\">Login to report or contact seller. Payments are arranged offline.</p>";

        if (state.user && !isOwner && canTrade) {
            actionHtml = `
                <div class="card-actions">
                    <button type="button" class="btn btn-secondary" data-action="message" data-id="${escapeHtml(listing._id)}">Message</button>
                    <button type="button" class="btn btn-secondary" data-action="offer" data-id="${escapeHtml(listing._id)}">Make Offer</button>
                    <button type="button" class="btn btn-secondary" data-action="report" data-id="${escapeHtml(listing._id)}">Report</button>
                    ${
                        listing.availability === "reserved"
                            ? "<span class=\"card-hint\">Reserved by another buyer.</span>"
                            : "<span class=\"card-hint\">Arrange payment and meetup offline with the seller.</span>"
                    }
                </div>
            `;
        }

        if (state.user && !isOwner && !canTrade) {
            actionHtml =
                "<p class=\"card-hint\">Your account is pending verification. Admin/moderator approval is required before messaging, offers, or reports.</p>";
        }

        if (state.user && isOwner) {
            actionHtml = "<p class=\"card-hint\">This is your listing.</p>";
        }

        const imageHtml = listing.image
            ? `<img class="listing-image" src="${escapeHtml(listing.image)}" alt="${escapeHtml(listing.title)}">`
            : "<div class=\"listing-image\"></div>";

        card.innerHTML = `
            ${imageHtml}
            <div class="listing-body">
                <p class="badge badge-approved">approved</p>
                <h3 class="listing-title">${escapeHtml(listing.title)}</h3>
                <p class="listing-price">${formatCurrency(listing.price)}</p>
                <p class="listing-description">${escapeHtml(truncate(listing.description, 140))}</p>
                <div class="meta-chips">${chips.join("")}</div>
                <div class="listing-meta">
                    <span>${escapeHtml(listing.location)}</span>
                    <span>${formatRelativeTime(listing.createdAt)}</span>
                </div>
                <div class="listing-meta">
                    <span>Seller: ${escapeHtml(sellerName)}</span>
                    <span>Rep: ${escapeHtml(String(sellerRep))}</span>
                </div>
                <div class="listing-meta">
                    <span>Phone: ${escapeHtml(formatPhone(listing.contactPhone))}</span>
                    <span>Views: ${escapeHtml(String(listing.viewsCount || 0))}</span>
                </div>
                ${actionHtml}
            </div>
        `;

        return card;
    }

    async function reportListing(listingId) {
        if (!ensureAuthenticated()) {
            return;
        }
        if (!canCurrentUserTrade()) {
            throw new Error(
                "Your account is pending verification. Admin/moderator approval is required before reporting."
            );
        }

        const reasonInput = window.prompt(
            "Enter report reason: Scam, Fake Product, Abusive Content, Spam, or Other"
        );

        if (reasonInput === null) {
            return;
        }

        const reason = normalizeReason(reasonInput);
        if (!reason) {
            throw new Error("Reason must be Scam, Fake Product, Abusive Content, Spam, or Other.");
        }

        const notes = window.prompt("Optional notes for admin review:", "") || "";
        const response = await apiRequest(
            `/listings/${listingId}/report`,
            {
                method: "POST",
                body: { reason, notes }
            },
            true
        );

        if (response.movedToPendingReview) {
            showToast("Report submitted. Listing moved to pending review.", "success");
            return;
        }

        showToast(response.message || "Report sent.", "success");
    }

    async function sendMessage(listingId) {
        if (!ensureAuthenticated()) {
            return;
        }
        if (!canCurrentUserTrade()) {
            throw new Error(
                "Your account is pending verification. Admin/moderator approval is required before messaging."
            );
        }

        const message = window.prompt("Enter your message for the seller:", "Is this still available?");

        if (message === null) {
            return;
        }

        const text = message.trim();
        if (text.length < 2) {
            throw new Error("Message must have at least 2 characters.");
        }

        const response = await apiRequest(
            `/listings/${listingId}/messages`,
            {
                method: "POST",
                body: { message: text }
            },
            true
        );

        showToast(response.message || "Message sent.", "success");
    }

    async function sendOffer(listingId) {
        if (!ensureAuthenticated()) {
            return;
        }
        if (!canCurrentUserTrade()) {
            throw new Error(
                "Your account is pending verification. Admin/moderator approval is required before offers."
            );
        }

        const offerInput = window.prompt("Enter your offer amount in KES:", "25000");
        if (offerInput === null) {
            return;
        }

        const offerAmount = Number(String(offerInput).replace(/,/g, "").trim());
        if (Number.isNaN(offerAmount) || offerAmount <= 0) {
            throw new Error("Offer amount must be a valid positive number.");
        }

        const message = window.prompt("Optional offer note for seller:", "Ready to buy today.") || "";
        const response = await apiRequest(
            `/listings/${listingId}/messages`,
            {
                method: "POST",
                body: { message, offerAmount }
            },
            true
        );

        showToast(response.message || "Offer sent to seller.", "success");
    }

    function initLoginPage() {
        if (state.user) {
            redirectByRole(state.user);
            return;
        }

        const loginForm = document.getElementById("loginForm");
        if (!loginForm) {
            return;
        }

        loginForm.addEventListener("submit", async (event) => {
            event.preventDefault();

            const formData = new FormData(loginForm);
            const email = String(formData.get("email") || "").trim();
            const password = String(formData.get("password") || "");

            try {
                const data = await apiRequest("/auth/login", {
                    method: "POST",
                    body: { email, password }
                });

                setSession(data.token, data.user);
                showToast("Login successful.", "success");

                setTimeout(() => {
                    redirectByRole(data.user);
                }, 300);
            } catch (error) {
                showToast(error.message || "Login failed.", "error");
            }
        });
    }

    function initRegisterPage() {
        if (state.user) {
            redirectByRole(state.user);
            return;
        }

        const registerForm = document.getElementById("registerForm");
        if (!registerForm) {
            return;
        }

        registerForm.addEventListener("submit", async (event) => {
            event.preventDefault();

            const formData = new FormData(registerForm);
            const name = String(formData.get("name") || "").trim();
            const email = String(formData.get("email") || "").trim();
            const phoneNumber = String(formData.get("phoneNumber") || "").trim();
            const city = String(formData.get("city") || "").trim();
            const password = String(formData.get("password") || "");

            try {
                const data = await apiRequest("/auth/register", {
                    method: "POST",
                    body: { name, email, phoneNumber, city, password }
                });

                setSession(data.token, data.user);
                showToast("Registration successful.", "success");

                setTimeout(() => {
                    redirectByRole(data.user);
                }, 300);
            } catch (error) {
                showToast(error.message || "Registration failed.", "error");
            }
        });
    }

    async function initDashboardPage() {
        if (!ensureAuthenticated()) {
            return;
        }

        const profileCard = document.getElementById("profileCard");
        const listingForm = document.getElementById("listingForm");
        const myListings = document.getElementById("myListings");
        const refreshBtn = document.getElementById("refreshListingsBtn");
        const sellerInbox = document.getElementById("sellerInbox");
        const inboxBadge = document.getElementById("inboxBadge");

        if (!profileCard || !listingForm || !myListings) {
            return;
        }

        renderProfileCard(profileCard, state.user);
        if (state.user.role === "user" && !state.user.communityVerified) {
            const controls = listingForm.querySelectorAll("input, textarea, select, button");
            controls.forEach((control) => {
                control.disabled = true;
            });
            showToast(
                "Account pending verification. Admin/moderator must verify you before trading actions.",
                "info"
            );
        }
        await loadSellerInbox(sellerInbox, inboxBadge);

        listingForm.addEventListener("submit", async (event) => {
            event.preventDefault();

            const payload = new FormData(listingForm);

            try {
                const data = await apiRequest(
                    "/listings",
                    {
                        method: "POST",
                        body: payload
                    },
                    true
                );

                showToast(data.message || "Listing submitted.", "success");
                listingForm.reset();
                await loadMyListings(myListings);
            } catch (error) {
                showToast(error.message || "Unable to create listing.", "error");
            }
        });

        myListings.addEventListener("click", async (event) => {
            const button = event.target.closest("button[data-action]");
            if (!button) {
                return;
            }

            const listingId = button.dataset.id;
            const action = button.dataset.action;
            if (!listingId) {
                return;
            }

            try {
                if (action === "view-messages") {
                    await loadListingMessages(listingId, true);
                    await loadSellerInbox(sellerInbox, inboxBadge);
                }

                if (action === "mark-available") {
                    await updateAvailability(listingId, "available");
                    await loadMyListings(myListings);
                }

                if (action === "mark-reserved") {
                    await updateAvailability(listingId, "reserved");
                    await loadMyListings(myListings);
                }

                if (action === "mark-sold") {
                    await updateAvailability(listingId, "sold");
                    await loadMyListings(myListings);
                }
            } catch (error) {
                showToast(error.message || "Unable to load messages.", "error");
            }
        });

        if (refreshBtn) {
            refreshBtn.addEventListener("click", async () => {
                await loadMyListings(myListings);
                await loadSellerInbox(sellerInbox, inboxBadge);
                showToast("Listings refreshed.", "success");
            });
        }

        if (sellerInbox) {
            sellerInbox.addEventListener("click", async (event) => {
                const button = event.target.closest("button[data-action='open-thread']");
                if (!button) {
                    return;
                }
                const listingId = button.dataset.id;
                if (!listingId) {
                    return;
                }

                try {
                    await loadListingMessages(listingId, true);
                    await loadSellerInbox(sellerInbox, inboxBadge);
                } catch (error) {
                    showToast(error.message || "Unable to open conversation.", "error");
                }
            });
        }

        await loadMyListings(myListings);
    }

    function renderProfileCard(container, user) {
        container.innerHTML = `
            <div class="profile-row"><span>Name</span><strong>${escapeHtml(user.name)}</strong></div>
            <div class="profile-row"><span>Email</span><strong>${escapeHtml(user.email)}</strong></div>
            <div class="profile-row"><span>Role</span><strong>${escapeHtml(user.role)}</strong></div>
            <div class="profile-row"><span>Community Access</span><strong>${
                user.communityVerified ? "Verified" : "Pending Verification"
            }</strong></div>
            <div class="profile-row"><span>Reputation</span><strong>${escapeHtml(String(user.reputationScore))}</strong></div>
            <div class="profile-row"><span>Phone</span><strong>${escapeHtml(formatPhone(user.phoneNumber))}</strong></div>
            <div class="profile-row"><span>City</span><strong>${escapeHtml(user.city || "Not set")}</strong></div>
            <div class="profile-row"><span>Seller Badge</span><strong>${user.verifiedSeller ? "Verified" : "Standard"}</strong></div>
        `;
    }

    async function loadSellerInbox(container, badgeElement) {
        if (!container) {
            return;
        }

        container.innerHTML = "<p class=\"empty-state\">Loading inbox...</p>";

        const data = await apiRequest("/listings/inbox", {}, true);
        const threads = Array.isArray(data.threads) ? data.threads : [];
        const unreadTotal = Number(data.unreadTotal || 0);

        if (badgeElement) {
            badgeElement.textContent = `Unread: ${unreadTotal}`;
            badgeElement.className = unreadTotal > 0 ? "badge badge-warning" : "badge badge-approved";
        }

        if (threads.length === 0) {
            container.innerHTML = "<p class=\"empty-state\">No buyer messages yet.</p>";
            return;
        }

        container.innerHTML = threads
            .map((thread) => {
                const unread = Number(thread.unreadCount || 0);
                const unreadChip = unread > 0 ? `<span class="chip chip-warning">${unread} unread</span>` : "";
                const lastBody = thread.lastMessage && thread.lastMessage.body ? thread.lastMessage.body : "";
                const lastTime =
                    thread.lastMessage && thread.lastMessage.createdAt
                        ? formatRelativeTime(thread.lastMessage.createdAt)
                        : "recent";

                return `
                    <article class="inbox-item ${unread > 0 ? "unread" : ""}">
                        <div class="inbox-top">
                            <p class="inbox-title">${escapeHtml(thread.title || "Listing")}</p>
                            <div class="meta-chips">
                                ${unreadChip}
                                <span class="chip">${escapeHtml(thread.availability || "available")}</span>
                            </div>
                        </div>
                        <p class="inbox-meta">${escapeHtml(thread.location || "Unknown location")} · ${escapeHtml(
                    lastTime
                )}</p>
                        <p class="card-hint">${escapeHtml(truncate(lastBody, 120))}</p>
                        <div class="card-actions">
                            <button class="btn btn-secondary" type="button" data-action="open-thread" data-id="${escapeHtml(
                                thread.listingId
                            )}">
                                Open Conversation
                            </button>
                        </div>
                    </article>
                `;
            })
            .join("");
    }

    async function loadMyListings(container) {
        container.innerHTML = "<p class=\"empty-state\">Loading your listings...</p>";

        const data = await apiRequest("/listings/mine", {}, true);
        const listings = Array.isArray(data.listings) ? data.listings : [];

        if (!listings.length) {
            container.innerHTML =
                "<p class=\"empty-state\">You do not have any listings yet. Create one using the form above.</p>";
            return;
        }

        container.innerHTML = "";
        const fragment = document.createDocumentFragment();

        for (const listing of listings) {
            fragment.appendChild(buildMyListingCard(listing));
        }

        container.appendChild(fragment);
    }

    function buildMyListingCard(listing) {
        const card = document.createElement("article");
        card.className = "listing-card";

        const imageHtml = listing.image
            ? `<img class=\"listing-image\" src=\"${escapeHtml(listing.image)}\" alt=\"${escapeHtml(listing.title)}\">`
            : "<div class=\"listing-image\"></div>";

        const messageCount = Array.isArray(listing.messages) ? listing.messages.length : 0;
        const chips = [
            `<span class="chip">${escapeHtml(listing.category || "Other")}</span>`,
            `<span class="chip">${escapeHtml(listing.itemCondition || "Used")}</span>`
        ];
        if (listing.negotiable) {
            chips.push("<span class=\"chip\">Negotiable</span>");
        }
        if (listing.deliveryAvailable) {
            chips.push("<span class=\"chip\">Delivery</span>");
        }
        if (listing.availability === "reserved") {
            chips.push("<span class=\"chip chip-warning\">Reserved</span>");
        }
        if (listing.availability === "sold") {
            chips.push("<span class=\"chip chip-sold\">Sold</span>");
        }

        let availabilityActions = "";
        if (listing.availability !== "available") {
            availabilityActions += `<button class="btn btn-secondary" type="button" data-action="mark-available" data-id="${escapeHtml(listing._id)}">Mark Available</button>`;
        }
        if (listing.availability !== "reserved") {
            availabilityActions += `<button class="btn btn-secondary" type="button" data-action="mark-reserved" data-id="${escapeHtml(listing._id)}">Mark Reserved</button>`;
        }
        if (listing.availability !== "sold") {
            availabilityActions += `<button class="btn btn-success" type="button" data-action="mark-sold" data-id="${escapeHtml(listing._id)}">Mark Sold</button>`;
        }

        card.innerHTML = `
            ${imageHtml}
            <div class="listing-body">
                <p class="badge ${getStatusClass(listing.status)}">${escapeHtml(listing.status)}</p>
                <h3 class="listing-title">${escapeHtml(listing.title)}</h3>
                <p class="listing-price">${formatCurrency(listing.price)}</p>
                <p class="listing-description">${escapeHtml(truncate(listing.description, 130))}</p>
                <div class="meta-chips">${chips.join("")}</div>
                <div class="listing-meta">
                    <span>${escapeHtml(listing.location)}</span>
                    <span>${formatRelativeTime(listing.createdAt)}</span>
                </div>
                <div class="listing-meta">
                    <span>Reports: ${escapeHtml(String(listing.reportsCount || 0))}</span>
                    <span>Messages: ${escapeHtml(String(messageCount))}</span>
                </div>
                <div class="listing-meta">
                    <span>Phone: ${escapeHtml(formatPhone(listing.contactPhone))}</span>
                    <span>Views: ${escapeHtml(String(listing.viewsCount || 0))}</span>
                </div>
                <div class="card-actions">
                    <button class="btn btn-secondary" type="button" data-action="view-messages" data-id="${escapeHtml(listing._id)}">
                        View Messages
                    </button>
                    ${availabilityActions}
                </div>
            </div>
        `;

        return card;
    }

    async function loadListingMessages(listingId, markReadForSeller = false) {
        const panel = document.getElementById("messagePanel");
        if (!panel) {
            return;
        }

        panel.innerHTML = "<p class=\"muted\">Loading messages...</p>";

        const data = await apiRequest(`/listings/${listingId}/messages`, {}, true);
        const messages = Array.isArray(data.messages) ? data.messages : [];

        if (markReadForSeller) {
            try {
                await apiRequest(
                    `/listings/${listingId}/messages/read`,
                    {
                        method: "PATCH"
                    },
                    true
                );
            } catch {
                // Ignore if current user is not the seller for this listing.
            }
        }

        if (!messages.length) {
            panel.innerHTML = "<p class=\"muted\">No messages yet for this listing.</p>";
            return;
        }

        panel.innerHTML = messages
            .map((message) => {
                const senderName =
                    (message.sender && message.sender.name) || message.senderName || "Marketplace user";
                const senderEmail =
                    (message.sender && message.sender.email) || message.senderEmail || "";
                const senderPhone =
                    (message.sender && message.sender.phoneNumber) || message.senderPhone || "";
                const senderCity =
                    (message.sender && message.sender.city) || message.senderCity || "";
                const offerTag =
                    typeof message.offerAmount === "number" && message.offerAmount > 0
                        ? ` <strong>Offer: ${escapeHtml(formatCurrency(message.offerAmount))}</strong>`
                        : "";
                const contactInfo = [senderEmail, senderPhone, senderCity]
                    .filter((value) => String(value || "").trim())
                    .join(" | ");

                return `
                    <article class="message-item">
                        <p class="message-meta">${escapeHtml(senderName)} · ${formatRelativeTime(
                    message.createdAt
                )}${offerTag}</p>
                        ${
                            contactInfo
                                ? `<p class="message-meta">Contact: ${escapeHtml(contactInfo)}</p>`
                                : ""
                        }
                        <p class="message-text">${escapeHtml(message.body)}</p>
                    </article>
                `;
            })
            .join("");
    }

    async function updateAvailability(listingId, availability) {
        const response = await apiRequest(
            `/listings/${listingId}/availability`,
            {
                method: "PATCH",
                body: { availability }
            },
            true
        );

        showToast(response.message || "Availability updated.", "success");
    }

    async function initAdminPage() {
        if (!ensureAuthenticated()) {
            return;
        }

        if (!state.user || !["admin", "moderator"].includes(state.user.role)) {
            showToast("Admin or moderator access required.", "error");
            setTimeout(() => {
                window.location.href = "dashboard.html";
            }, 500);
            return;
        }

        const isAdmin = state.user.role === "admin";
        const refreshBtn = document.getElementById("refreshAdminBtn");
        const statusFilter = document.getElementById("adminStatusFilter");
        const pendingListings = document.getElementById("pendingListings");
        const adminListings = document.getElementById("adminListings");
        const adminUsersSection = document.getElementById("adminUsersSection");
        const adminUsersBody = document.getElementById("adminUserRows");
        const adminLogsSection = document.getElementById("adminLogsSection");

        if (!pendingListings || !adminListings) {
            return;
        }

        if (!isAdmin) {
            if (adminUsersSection) {
                adminUsersSection.classList.add("hidden");
            }
            if (adminLogsSection) {
                adminLogsSection.classList.add("hidden");
            }
        }

        if (refreshBtn) {
            refreshBtn.addEventListener("click", async () => {
                await refreshAdminData();
                showToast("Admin data refreshed.", "success");
            });
        }

        if (statusFilter) {
            statusFilter.addEventListener("change", async () => {
                await loadAdminListings(statusFilter.value.trim());
            });
        }

        pendingListings.addEventListener("click", async (event) => {
            const button = event.target.closest("button[data-admin-action]");
            if (!button) {
                return;
            }

            const listingId = button.dataset.id;
            const nextStatus = button.dataset.status;

            if (!listingId || !nextStatus) {
                return;
            }

            await moderateListing(listingId, nextStatus);
        });

        adminListings.addEventListener("click", async (event) => {
            const button = event.target.closest("button[data-admin-action]");
            if (!button) {
                return;
            }

            const listingId = button.dataset.id;
            const nextStatus = button.dataset.status;

            if (!listingId || !nextStatus) {
                return;
            }

            await moderateListing(listingId, nextStatus);
        });

        if (isAdmin && adminUsersBody) {
            adminUsersBody.addEventListener("click", async (event) => {
                const button = event.target.closest("button[data-user-action]");
                if (!button) {
                    return;
                }

                const userId = button.dataset.id;
                const userAction = button.dataset.userAction;
                const role = button.dataset.role;

                if (!userId || !userAction) {
                    return;
                }

                try {
                    if (userAction === "verify") {
                        await setUserVerification(userId, true);
                    }
                    if (userAction === "unverify") {
                        await setUserVerification(userId, false);
                    }
                    if (userAction === "set-role" && role) {
                        await setUserRole(userId, role);
                    }
                    await loadAdminUsers();
                    await loadAdminLogs();
                } catch (error) {
                    showToast(error.message || "User update failed.", "error");
                }
            });
        }

        await refreshAdminData();
    }

    async function refreshAdminData() {
        const tasks = [
            loadAnalytics(),
            loadPendingListings(),
            loadAdminListings((document.getElementById("adminStatusFilter") || {}).value || ""),
            loadReports()
        ];

        if (state.user && state.user.role === "admin") {
            tasks.push(loadAdminUsers());
            tasks.push(loadAdminLogs());
        }

        await Promise.all(tasks);
    }

    async function loadAnalytics() {
        const container = document.getElementById("analyticsCards");
        if (!container) {
            return;
        }

        const data = await apiRequest("/admin/analytics", {}, true);
        container.innerHTML = `
            <article class="metric"><h3>Total Users</h3><p>${escapeHtml(String(data.totalUsers || 0))}</p></article>
            <article class="metric"><h3>Moderators</h3><p>${escapeHtml(String(data.totalModerators || 0))}</p></article>
            <article class="metric"><h3>Verified Users</h3><p>${escapeHtml(String(data.verifiedUsers || 0))}</p></article>
            <article class="metric"><h3>Pending Verify</h3><p>${escapeHtml(
                String(data.pendingVerification || 0)
            )}</p></article>
            <article class="metric"><h3>Total Listings</h3><p>${escapeHtml(String(data.totalListings || 0))}</p></article>
            <article class="metric"><h3>Total Reports</h3><p>${escapeHtml(String(data.totalReports || 0))}</p></article>
            <article class="metric"><h3>Pending</h3><p>${escapeHtml(String(data.pendingListings || 0))}</p></article>
            <article class="metric"><h3>Approved</h3><p>${escapeHtml(String(data.approvedListings || 0))}</p></article>
            <article class="metric"><h3>Rejected</h3><p>${escapeHtml(String(data.rejectedListings || 0))}</p></article>
            <article class="metric"><h3>Sold</h3><p>${escapeHtml(String(data.soldListings || 0))}</p></article>
            <article class="metric"><h3>Flagged</h3><p>${escapeHtml(String(data.flaggedListings || 0))}</p></article>
            <article class="metric"><h3>Avg Price</h3><p>${escapeHtml(formatCurrency(data.averagePrice || 0))}</p></article>
            <article class="metric"><h3>Avg Reputation</h3><p>${escapeHtml(String(data.averageReputation || 0))}</p></article>
        `;
    }

    async function loadPendingListings() {
        const container = document.getElementById("pendingListings");
        if (!container) {
            return;
        }

        container.innerHTML = "<p class=\"empty-state\">Loading pending listings...</p>";

        const data = await apiRequest("/admin/pending", {}, true);
        const listings = Array.isArray(data.listings) ? data.listings : [];

        if (!listings.length) {
            container.innerHTML = "<p class=\"empty-state\">No pending listings at the moment.</p>";
            return;
        }

        container.innerHTML = "";
        const fragment = document.createDocumentFragment();

        for (const listing of listings) {
            fragment.appendChild(buildAdminListingCard(listing));
        }

        container.appendChild(fragment);
    }

    async function loadAdminListings(status) {
        const container = document.getElementById("adminListings");
        if (!container) {
            return;
        }

        container.innerHTML = "<p class=\"empty-state\">Loading listings...</p>";

        const params = new URLSearchParams();
        if (status) {
            params.set("status", status);
        }

        const endpoint = params.toString() ? `/admin/listings?${params.toString()}` : "/admin/listings";
        const data = await apiRequest(endpoint, {}, true);
        const listings = Array.isArray(data.listings) ? data.listings : [];

        if (!listings.length) {
            container.innerHTML = "<p class=\"empty-state\">No listings match this filter.</p>";
            return;
        }

        container.innerHTML = "";
        const fragment = document.createDocumentFragment();

        for (const listing of listings) {
            fragment.appendChild(buildAdminListingCard(listing));
        }

        container.appendChild(fragment);
    }

    async function loadReports() {
        const tableBody = document.getElementById("reportRows");
        if (!tableBody) {
            return;
        }

        tableBody.innerHTML = "<tr><td colspan=\"5\">Loading reports...</td></tr>";

        const data = await apiRequest("/admin/reports", {}, true);
        const reports = Array.isArray(data.reports) ? data.reports : [];

        if (!reports.length) {
            tableBody.innerHTML = "<tr><td colspan=\"5\">No reports submitted yet.</td></tr>";
            return;
        }

        tableBody.innerHTML = reports
            .map((report) => {
                const listingTitle = report.listing && report.listing.title ? report.listing.title : "Deleted listing";
                const reporter = report.reporter && report.reporter.name ? report.reporter.name : "Unknown";
                const seller = report.seller && report.seller.name ? report.seller.name : "Unknown";
                const listingInfo = report.listing
                    ? `${listingTitle} (${report.listing.category || "Other"}, ${
                          report.listing.itemCondition || "Used"
                      }, ${report.listing.availability || "available"})`
                    : listingTitle;

                return `
                    <tr>
                        <td>${escapeHtml(formatDate(report.createdAt))}</td>
                        <td>${escapeHtml(listingInfo)}</td>
                        <td>${escapeHtml(report.reason || "-")}</td>
                        <td>${escapeHtml(reporter)}</td>
                        <td>${escapeHtml(seller)}</td>
                    </tr>
                `;
            })
            .join("");
    }

    async function loadAdminUsers() {
        const tableBody = document.getElementById("adminUserRows");
        if (!tableBody || !state.user || state.user.role !== "admin") {
            return;
        }

        tableBody.innerHTML = "<tr><td colspan=\"7\">Loading users...</td></tr>";

        const data = await apiRequest("/admin/users", {}, true);
        const users = Array.isArray(data.users) ? data.users : [];

        if (!users.length) {
            tableBody.innerHTML = "<tr><td colspan=\"7\">No users found.</td></tr>";
            return;
        }

        tableBody.innerHTML = users
            .map((user) => {
                const roleActions =
                    user.role === "user"
                        ? `<button class="btn btn-secondary" data-user-action="set-role" data-role="moderator" data-id="${escapeHtml(
                              user._id
                          )}">Make Moderator</button>`
                        : user.role === "moderator"
                        ? `<button class="btn btn-secondary" data-user-action="set-role" data-role="user" data-id="${escapeHtml(
                              user._id
                          )}">Make User</button>`
                        : "<span class=\"chip chip-verified\">Admin</span>";

                const verifyAction = user.communityVerified
                    ? `<button class="btn btn-danger" data-user-action="unverify" data-id="${escapeHtml(
                          user._id
                      )}">Unverify</button>`
                    : `<button class="btn btn-success" data-user-action="verify" data-id="${escapeHtml(
                          user._id
                      )}">Verify</button>`;

                return `
                    <tr>
                        <td>${escapeHtml(user.name || "User")}</td>
                        <td>${escapeHtml(user.email || "-")}</td>
                        <td>${escapeHtml(user.role || "user")}</td>
                        <td>${user.communityVerified ? "Yes" : "No"}</td>
                        <td>${escapeHtml(String(user.reputationScore || 0))}</td>
                        <td>${escapeHtml(formatDate(user.lastSeenAt || user.createdAt))}</td>
                        <td class="table-actions">${verifyAction} ${roleActions}</td>
                    </tr>
                `;
            })
            .join("");
    }

    async function setUserVerification(userId, communityVerified) {
        const response = await apiRequest(
            `/admin/users/${userId}/verify`,
            {
                method: "PATCH",
                body: {
                    communityVerified
                }
            },
            true
        );
        showToast(response.message || "User verification updated.", "success");
    }

    async function setUserRole(userId, role) {
        const response = await apiRequest(
            `/admin/users/${userId}/role`,
            {
                method: "PATCH",
                body: { role }
            },
            true
        );
        showToast(response.message || "User role updated.", "success");
    }

    async function loadAdminLogs() {
        const tableBody = document.getElementById("adminLogRows");
        if (!tableBody || !state.user || state.user.role !== "admin") {
            return;
        }

        tableBody.innerHTML = "<tr><td colspan=\"5\">Loading moderation logs...</td></tr>";

        const data = await apiRequest("/admin/logs", {}, true);
        const logs = Array.isArray(data.logs) ? data.logs : [];

        if (!logs.length) {
            tableBody.innerHTML = "<tr><td colspan=\"5\">No admin/moderation logs yet.</td></tr>";
            return;
        }

        tableBody.innerHTML = logs
            .map((log) => {
                const actor = log.actor && log.actor.name ? log.actor.name : "Unknown";
                return `
                    <tr>
                        <td>${escapeHtml(formatDate(log.createdAt))}</td>
                        <td>${escapeHtml(actor)}</td>
                        <td>${escapeHtml(log.action || "-")}</td>
                        <td>${escapeHtml(log.targetType || "-")}</td>
                        <td>${escapeHtml(log.targetId || "-")}</td>
                    </tr>
                `;
            })
            .join("");
    }

    function buildAdminListingCard(listing) {
        const card = document.createElement("article");
        card.className = "listing-card";

        const sellerName = listing.seller && listing.seller.name ? listing.seller.name : "Unknown seller";
        const sellerEmail = listing.seller && listing.seller.email ? listing.seller.email : "No email";
        const sellerReputation =
            listing.seller && typeof listing.seller.reputationScore === "number"
                ? listing.seller.reputationScore
                : "N/A";
        const sellerVerified = !!(listing.seller && listing.seller.verifiedSeller);

        const chips = [
            `<span class="chip">${escapeHtml(listing.category || "Other")}</span>`,
            `<span class="chip">${escapeHtml(listing.itemCondition || "Used")}</span>`
        ];
        if (listing.deliveryAvailable) {
            chips.push("<span class=\"chip\">Delivery</span>");
        }
        if (listing.negotiable) {
            chips.push("<span class=\"chip\">Negotiable</span>");
        }
        if (listing.availability === "reserved") {
            chips.push("<span class=\"chip chip-warning\">Reserved</span>");
        }
        if (listing.availability === "sold") {
            chips.push("<span class=\"chip chip-sold\">Sold</span>");
        }
        if (sellerVerified) {
            chips.push("<span class=\"chip chip-verified\">Verified Seller</span>");
        }

        let actions = "";
        if (listing.status === "pending") {
            actions = `
                <div class="card-actions">
                    <button type="button" class="btn btn-success" data-admin-action="status" data-status="approved" data-id="${escapeHtml(listing._id)}">Approve</button>
                    <button type="button" class="btn btn-danger" data-admin-action="status" data-status="rejected" data-id="${escapeHtml(listing._id)}">Reject</button>
                </div>
            `;
        }

        if (listing.status === "approved") {
            actions = `
                <div class="card-actions">
                    <button type="button" class="btn btn-danger" data-admin-action="status" data-status="rejected" data-id="${escapeHtml(listing._id)}">Reject</button>
                </div>
            `;
        }

        if (listing.status === "rejected") {
            actions = `
                <div class="card-actions">
                    <button type="button" class="btn btn-success" data-admin-action="status" data-status="approved" data-id="${escapeHtml(listing._id)}">Approve</button>
                </div>
            `;
        }

        const imageHtml = listing.image
            ? `<img class=\"listing-image\" src=\"${escapeHtml(listing.image)}\" alt=\"${escapeHtml(listing.title)}\">`
            : "<div class=\"listing-image\"></div>";

        card.innerHTML = `
            ${imageHtml}
            <div class="listing-body">
                <p class="badge ${getStatusClass(listing.status)}">${escapeHtml(listing.status)}</p>
                <h3 class="listing-title">${escapeHtml(listing.title)}</h3>
                <p class="listing-price">${formatCurrency(listing.price)}</p>
                <p class="listing-description">${escapeHtml(truncate(listing.description, 120))}</p>
                <div class="meta-chips">${chips.join("")}</div>
                <div class="listing-meta">
                    <span>${escapeHtml(listing.location)}</span>
                    <span>${formatRelativeTime(listing.createdAt)}</span>
                </div>
                <div class="listing-meta">
                    <span>${escapeHtml(sellerName)}</span>
                    <span>Rep: ${escapeHtml(String(sellerReputation))}</span>
                </div>
                <div class="listing-meta">
                    <span>${escapeHtml(sellerEmail)}</span>
                    <span>Reports: ${escapeHtml(String(listing.reportsCount || 0))}</span>
                </div>
                <div class="listing-meta">
                    <span>Phone: ${escapeHtml(formatPhone(listing.contactPhone))}</span>
                    <span>Views: ${escapeHtml(String(listing.viewsCount || 0))}</span>
                </div>
                ${actions}
            </div>
        `;

        return card;
    }

    async function moderateListing(listingId, status) {
        try {
            const response = await apiRequest(
                `/admin/listings/${listingId}/status`,
                {
                    method: "PATCH",
                    body: { status }
                },
                true
            );

            showToast(response.message || "Listing status updated.", "success");
            await refreshAdminData();
        } catch (error) {
            showToast(error.message || "Failed to update listing status.", "error");
        }
    }
})();
