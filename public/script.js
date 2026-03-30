
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
        meta: null,
        refreshInFlight: null
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
        const navInner = navbar.querySelector(".nav-inner");

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
                    const isMenuOpen = !!(navInner && navInner.classList.contains("menu-open"));

                    if (currentY > 10) {
                        navbar.classList.add("navbar-scrolled");
                    } else {
                        navbar.classList.remove("navbar-scrolled");
                    }

                    if (isMenuOpen) {
                        navbar.classList.remove("navbar-hidden");
                    } else if (scrollingDown && currentY > 80) {
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
        if (token) {
            localStorage.setItem(TOKEN_KEY, token);
        }

        if (user) {
            localStorage.setItem(USER_CACHE_KEY, JSON.stringify(user));
            state.user = user;
        }
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
        try {
            const data = await apiRequest("/auth/me", {}, true);
            state.user = data.user;
            localStorage.setItem(USER_CACHE_KEY, JSON.stringify(data.user));
        } catch {
            state.user = null;
            localStorage.removeItem(USER_CACHE_KEY);
        }
    }

    async function refreshCurrentUser() {
        const token = getToken();
        if (!token) {
            return null;
        }

        const data = await apiRequest("/auth/me", {}, true);
        state.user = data.user;
        localStorage.setItem(USER_CACHE_KEY, JSON.stringify(data.user));
        return data.user;
    }

    function applyWalletToCurrentUser(wallet) {
        if (!state.user || !wallet) {
            return;
        }

        const available = Number(wallet.available);
        const held = Number(wallet.held);

        if (Number.isFinite(available)) {
            state.user.walletBalance = available;
        }
        if (Number.isFinite(held)) {
            state.user.walletHeldBalance = held;
        }

        localStorage.setItem(USER_CACHE_KEY, JSON.stringify(state.user));
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
        setupNavigationMenu(navSearchForm, authLinks);

        const logoutBtn = document.getElementById("logoutBtn");
        if (logoutBtn) {
            logoutBtn.addEventListener("click", async () => {
                try {
                    await apiRequest(
                        "/auth/logout",
                        {
                            method: "POST"
                        },
                        false
                    );
                } catch {
                    // Continue local logout even if network call fails.
                }
                clearSession();
                showToast("You have been logged out.", "success");
                setTimeout(() => {
                    window.location.href = "index.html";
                }, 350);
            });
        }
    }

    function setupNavigationMenu(navSearchForm, authLinks) {
        if (!authLinks) {
            return;
        }

        const navInner = authLinks.closest(".nav-inner");
        if (!navInner) {
            return;
        }

        let toggle = navInner.querySelector(".nav-toggle");
        if (!toggle) {
            toggle = document.createElement("button");
            toggle.type = "button";
            toggle.className = "nav-toggle";
            toggle.setAttribute("aria-label", "Open menu");
            toggle.setAttribute("aria-expanded", "false");
            toggle.innerHTML = "<span></span><span></span><span></span>";
            navInner.insertBefore(toggle, authLinks);
        }

        const isMobileViewport = () => window.innerWidth <= 960;

        const syncToggleState = () => {
            const mobileOpen = navInner.classList.contains("menu-open");
            const isMobile = isMobileViewport();

            toggle.style.display = isMobile ? "inline-flex" : "none";
            toggle.classList.toggle("is-open", isMobile && mobileOpen);
            toggle.setAttribute("aria-expanded", isMobile && mobileOpen ? "true" : "false");
            toggle.setAttribute(
                "aria-label",
                isMobile && mobileOpen ? "Close menu" : "Open menu"
            );
        };

        navInner.classList.remove("menu-open", "menu-collapsed");
        syncToggleState();

        toggle.addEventListener("click", () => {
            if (!isMobileViewport()) {
                return;
            }

            navInner.classList.toggle("menu-open");
            syncToggleState();
        });

        const closeMobileMenu = () => {
            if (navInner.classList.contains("menu-open")) {
                navInner.classList.remove("menu-open");
                syncToggleState();
            }
        };

        authLinks.addEventListener("click", (event) => {
            if (isMobileViewport() && event.target.closest("a,button")) {
                closeMobileMenu();
            }
        });

        if (navSearchForm) {
            navSearchForm.addEventListener("submit", () => {
                closeMobileMenu();
            });
        }

        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape" && isMobileViewport()) {
                closeMobileMenu();
            }
        });

        window.addEventListener("resize", () => {
            if (!isMobileViewport()) {
                navInner.classList.remove("menu-open");
            }
            navInner.classList.remove("menu-collapsed");
            syncToggleState();
        });

        document.addEventListener("click", (event) => {
            if (isMobileViewport() && !navInner.contains(event.target)) {
                closeMobileMenu();
            }
        });
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

    async function refreshAccessToken() {
        if (state.refreshInFlight) {
            return state.refreshInFlight;
        }

        state.refreshInFlight = (async () => {
            try {
                const response = await fetch(`${API_BASE}/auth/refresh`, {
                    method: "POST",
                    credentials: "include"
                });
                if (!response.ok) {
                    return false;
                }

                const contentType = response.headers.get("content-type") || "";
                if (!contentType.includes("application/json")) {
                    return false;
                }

                const payload = await response.json();
                if (payload && payload.token) {
                    localStorage.setItem(TOKEN_KEY, payload.token);
                }
                if (payload && payload.user) {
                    localStorage.setItem(USER_CACHE_KEY, JSON.stringify(payload.user));
                    state.user = payload.user;
                }
                return true;
            } catch {
                return false;
            }
        })();

        try {
            return await state.refreshInFlight;
        } finally {
            state.refreshInFlight = null;
        }
    }

    async function apiRequest(endpoint, options = {}, requiresAuth = false) {
        const config = {
            method: options.method || "GET",
            headers: {},
            credentials: "include"
        };

        if (requiresAuth) {
            const token = getToken();
            if (token) {
                config.headers.Authorization = `Bearer ${token}`;
            }
        }

        if (options.body instanceof FormData) {
            config.body = options.body;
        } else if (options.body !== undefined) {
            config.headers["Content-Type"] = "application/json";
            config.body = JSON.stringify(options.body);
        }

        let response = await fetch(`${API_BASE}${endpoint}`, config);
        if (
            response.status === 401 &&
            requiresAuth &&
            !endpoint.startsWith("/auth/refresh") &&
            !endpoint.startsWith("/auth/login")
        ) {
            const refreshed = await refreshAccessToken();
            if (refreshed) {
                const nextToken = getToken();
                if (nextToken) {
                    config.headers.Authorization = `Bearer ${nextToken}`;
                } else {
                    delete config.headers.Authorization;
                }
                response = await fetch(`${API_BASE}${endpoint}`, config);
            }
        }
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

    function isStrongPassword(password) {
        const value = String(password || "");
        if (value.length < 8) {
            return false;
        }
        if (!/[a-z]/i.test(value)) {
            return false;
        }
        if (!/\d/.test(value)) {
            return false;
        }
        return true;
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
        if (!state.user) {
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

                if (action === "start-escrow") {
                    await startEscrow(listingId);
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
        const isServiceListing =
            String(listing.category || "")
                .trim()
                .toLowerCase() === "services";

        const chips = [
            `<span class="chip">${escapeHtml(listing.category || "Other")}</span>`,
            `<span class="chip">${escapeHtml(listing.itemCondition || "Used")}</span>`
        ];
        if (String(listing.listingType || "").toLowerCase() === "service") {
            chips.push("<span class=\"chip\">Service</span>");
        }
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
        if (String(listing.riskLevel || "").toLowerCase() === "high") {
            chips.push("<span class=\"chip chip-warning\">High Risk</span>");
        }
        if (sellerVerified) {
            chips.push("<span class=\"chip chip-verified\">Verified Seller</span>");
        }

        let actionHtml = isServiceListing
            ? "<p class=\"card-hint\">Login to contact the service provider. Service listings are connection-only.</p>"
            : "<p class=\"card-hint\">Login to message seller or use TradeCircle Secure Hold.</p>";

        if (state.user && !isOwner && canTrade) {
            const paymentAction =
                listing.availability === "reserved"
                    ? "<span class=\"card-hint\">Reserved by another buyer.</span>"
                    : isServiceListing
                    ? "<span class=\"card-hint\">Service listing: connect directly with the seller. In-app payment is not required.</span>"
                    : `<button type="button" class="btn btn-primary" data-action="start-escrow" data-id="${escapeHtml(
                          listing._id
                      )}">Secure Hold</button>`;

            actionHtml = `
                <div class="card-actions">
                    <button type="button" class="btn btn-secondary" data-action="message" data-id="${escapeHtml(listing._id)}">Message</button>
                    <button type="button" class="btn btn-secondary" data-action="offer" data-id="${escapeHtml(listing._id)}">Make Offer</button>
                    <button type="button" class="btn btn-secondary" data-action="report" data-id="${escapeHtml(listing._id)}">Report</button>
                    ${paymentAction}
                </div>
                ${
                    isServiceListing
                        ? "<p class=\"card-hint\">TradeCircle helps you connect with service providers and agree terms directly.</p>"
                        : "<p class=\"card-hint\">Use Secure Hold only after negotiating with the seller via message or offer.</p>"
                }
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

    async function decideOffer(listingId, messageId, decision) {
        const decisionLabel = decision === "accepted" ? "accept" : "reject";
        const proceed = window.confirm(`Are you sure you want to ${decisionLabel} this offer?`);
        if (!proceed) {
            return;
        }

        const response = await apiRequest(
            `/listings/${listingId}/offers/${messageId}/decision`,
            {
                method: "PATCH",
                body: { decision }
            },
            true
        );

        showToast(response.message || "Offer updated.", "success");
    }

    async function startEscrow(listingId) {
        if (!ensureAuthenticated()) {
            return;
        }
        if (!canCurrentUserTrade()) {
            throw new Error(
                "Your account is pending verification. Admin/moderator approval is required before escrow."
            );
        }

        const amountInput = window.prompt(
            "After negotiation, enter amount to hold in escrow (leave blank to use listing price):",
            ""
        );
        if (amountInput === null) {
            return;
        }

        const note = window.prompt("Optional note for seller (agreed terms):", "") || "";
        const payload = {
            listingId,
            note
        };

        const parsedAmount = Number(String(amountInput || "").replace(/,/g, "").trim());
        if (String(amountInput || "").trim()) {
            if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
                throw new Error("Escrow amount must be a valid positive number.");
            }
            payload.amount = parsedAmount;
        }

        const response = await apiRequest(
            "/escrow/start",
            {
                method: "POST",
                body: payload
            },
            true
        );

        applyWalletToCurrentUser(response.wallet);
        showToast(response.message || "Escrow funded successfully.", "success");
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

            if (!isStrongPassword(password)) {
                showToast(
                    "Password must be at least 8 characters and include both letters and numbers.",
                    "error"
                );
                return;
            }

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
        const buyerConversations = document.getElementById("buyerConversations");
        const escrowDeals = document.getElementById("escrowDeals");
        const walletTransactions = document.getElementById("walletTransactions");
        const walletTopupForm = document.getElementById("walletTopupForm");
        const notificationList = document.getElementById("notificationList");
        const notificationBadge = document.getElementById("notificationBadge");
        const markAllNotificationsBtn = document.getElementById("markAllNotificationsBtn");
        const categoryInput = listingForm.querySelector("select[name='category']");
        const conditionInput = document.getElementById("itemConditionInput");
        const serviceFields = document.getElementById("serviceFields");
        const serviceRemoteField = document.getElementById("serviceRemoteField");
        const deliveryField = listingForm.querySelector("input[name='deliveryAvailable']")
            ? listingForm.querySelector("input[name='deliveryAvailable']").closest("label")
            : null;
        const meetupField = listingForm.querySelector("input[name='meetupAvailable']")
            ? listingForm.querySelector("input[name='meetupAvailable']").closest("label")
            : null;
        const conditionField = conditionInput ? conditionInput.closest("label") : null;

        if (!profileCard || !listingForm || !myListings) {
            return;
        }

        renderProfileCard(profileCard, state.user);

        const syncListingTypeFields = () => {
            const isService =
                String((categoryInput && categoryInput.value) || "")
                    .trim()
                    .toLowerCase() === "services";

            if (serviceFields) {
                serviceFields.classList.toggle("hidden", !isService);
            }
            if (serviceRemoteField) {
                serviceRemoteField.classList.toggle("hidden", !isService);
            }
            if (conditionField) {
                conditionField.classList.toggle("hidden", isService);
            }
            if (deliveryField) {
                deliveryField.classList.toggle("hidden", isService);
            }
            if (meetupField) {
                meetupField.classList.toggle("hidden", false);
            }
            if (conditionInput) {
                conditionInput.required = !isService;
            }
        };

        if (categoryInput) {
            categoryInput.addEventListener("change", syncListingTypeFields);
            syncListingTypeFields();
        }

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
        await loadBuyerConversations(buyerConversations);
        await loadEscrowDeals(escrowDeals);
        await loadWalletTransactions(walletTransactions);
        await loadNotifications(notificationList, notificationBadge);

        if (walletTopupForm) {
            walletTopupForm.addEventListener("submit", async (event) => {
                event.preventDefault();
                const amountInput = walletTopupForm.querySelector("#walletTopupAmount");
                const amount = Number(
                    String(amountInput ? amountInput.value : "")
                        .replace(/,/g, "")
                        .trim()
                );

                if (!Number.isFinite(amount) || amount <= 0) {
                    showToast("Top up amount must be a valid positive number.", "error");
                    return;
                }

                try {
                    const response = await apiRequest(
                        "/escrow/wallet/topup",
                        {
                            method: "POST",
                            body: { amount }
                        },
                        true
                    );
                    applyWalletToCurrentUser(response.wallet);
                    renderProfileCard(profileCard, state.user);
                    await loadWalletTransactions(walletTransactions);
                    walletTopupForm.reset();
                    showToast(response.message || "Wallet topped up.", "success");
                } catch (error) {
                    showToast(error.message || "Unable to top up wallet.", "error");
                }
            });
        }

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
                    await loadBuyerConversations(buyerConversations);
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

                if (action === "delete-listing") {
                    await removeListing(listingId);
                    await loadMyListings(myListings);
                    await loadSellerInbox(sellerInbox, inboxBadge);
                    await loadBuyerConversations(buyerConversations);
                    await loadEscrowDeals(escrowDeals);
                }
            } catch (error) {
                showToast(error.message || "Unable to load messages.", "error");
            }
        });

        if (refreshBtn) {
            refreshBtn.addEventListener("click", async () => {
                try {
                    await refreshCurrentUser();
                    renderProfileCard(profileCard, state.user);
                } catch {
                    // Continue refreshing listings even if profile refresh fails.
                }
                await loadMyListings(myListings);
                await loadSellerInbox(sellerInbox, inboxBadge);
                await loadBuyerConversations(buyerConversations);
                await loadEscrowDeals(escrowDeals);
                await loadWalletTransactions(walletTransactions);
                await loadNotifications(notificationList, notificationBadge);
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
                    await loadBuyerConversations(buyerConversations);
                } catch (error) {
                    showToast(error.message || "Unable to open conversation.", "error");
                }
            });
        }

        if (buyerConversations) {
            buyerConversations.addEventListener("click", async (event) => {
                const button = event.target.closest("button[data-action='open-thread']");
                if (!button) {
                    return;
                }
                const listingId = button.dataset.id;
                if (!listingId) {
                    return;
                }

                try {
                    await loadListingMessages(listingId, false);
                    await loadBuyerConversations(buyerConversations);
                } catch (error) {
                    showToast(error.message || "Unable to open conversation.", "error");
                }
            });
        }

        const messagePanel = document.getElementById("messagePanel");
        if (messagePanel) {
            messagePanel.addEventListener("click", async (event) => {
                const button = event.target.closest("button[data-offer-decision]");
                if (!button) {
                    return;
                }

                const listingId = String(messagePanel.dataset.listingId || "").trim();
                const messageId = String(button.dataset.messageId || "").trim();
                const decision = String(button.dataset.offerDecision || "").trim();
                if (!listingId || !messageId || !decision) {
                    return;
                }

                try {
                    await decideOffer(listingId, messageId, decision);
                    await loadListingMessages(listingId, true);
                    await loadMyListings(myListings);
                    await loadNotifications(notificationList, notificationBadge);
                    await loadBuyerConversations(buyerConversations);
                } catch (error) {
                    showToast(error.message || "Offer decision failed.", "error");
                }
            });

            messagePanel.addEventListener("submit", async (event) => {
                const form = event.target.closest("form[data-reply-form]");
                if (!form) {
                    return;
                }
                event.preventDefault();

                const listingId = String(form.dataset.listingId || "").trim();
                const input = form.querySelector("textarea[name='replyMessage']");
                const message = String((input && input.value) || "").trim();

                if (!listingId) {
                    showToast("Listing thread is missing.", "error");
                    return;
                }
                if (message.length < 2) {
                    showToast("Reply must have at least 2 characters.", "error");
                    return;
                }

                try {
                    await sendConversationReply(listingId, message);
                    if (input) {
                        input.value = "";
                    }
                    await loadListingMessages(listingId, false);
                    await loadSellerInbox(sellerInbox, inboxBadge);
                    await loadBuyerConversations(buyerConversations);
                    await loadNotifications(notificationList, notificationBadge);
                } catch (error) {
                    showToast(error.message || "Unable to send reply.", "error");
                }
            });
        }

        if (escrowDeals) {
            escrowDeals.addEventListener("click", async (event) => {
                const button = event.target.closest("button[data-escrow-action]");
                if (!button) {
                    return;
                }

                const escrowId = button.dataset.id;
                const action = button.dataset.escrowAction;
                if (!escrowId || !action) {
                    return;
                }

                try {
                    await runEscrowAction(escrowId, action);
                    await refreshCurrentUser();
                    renderProfileCard(profileCard, state.user);
                    await loadEscrowDeals(escrowDeals);
                    await loadWalletTransactions(walletTransactions);
                    await loadMyListings(myListings);
                    await loadBuyerConversations(buyerConversations);
                } catch (error) {
                    showToast(error.message || "Escrow action failed.", "error");
                }
            });
        }

        if (notificationList) {
            notificationList.addEventListener("click", async (event) => {
                const button = event.target.closest("button[data-notification-id]");
                if (!button) {
                    return;
                }
                const notificationId = String(button.dataset.notificationId || "").trim();
                if (!notificationId) {
                    return;
                }

                try {
                    await markNotificationRead(notificationId);
                    await loadNotifications(notificationList, notificationBadge);
                } catch (error) {
                    showToast(error.message || "Could not update notification.", "error");
                }
            });
        }

        if (markAllNotificationsBtn) {
            markAllNotificationsBtn.addEventListener("click", async () => {
                try {
                    await markAllNotificationsRead();
                    await loadNotifications(notificationList, notificationBadge);
                } catch (error) {
                    showToast(error.message || "Could not mark notifications as read.", "error");
                }
            });
        }

        await loadMyListings(myListings);
    }

    function renderProfileCard(container, user) {
        const walletAvailable = formatCurrency(Number(user.walletBalance || 0));
        const walletHeld = formatCurrency(Number(user.walletHeldBalance || 0));

        container.innerHTML = `
            <div class="profile-row"><span>Name</span><strong>${escapeHtml(user.name)}</strong></div>
            <div class="profile-row"><span>Email</span><strong>${escapeHtml(user.email)}</strong></div>
            <div class="profile-row"><span>Role</span><strong>${escapeHtml(user.role)}</strong></div>
            <div class="profile-row"><span>Community Access</span><strong>${
                user.communityVerified ? "Verified" : "Pending Verification"
            }</strong></div>
            <div class="profile-row"><span>Reputation</span><strong>${escapeHtml(String(user.reputationScore))}</strong></div>
            <div class="profile-row"><span>Wallet Available</span><strong>${escapeHtml(walletAvailable)}</strong></div>
            <div class="profile-row"><span>Wallet Held</span><strong>${escapeHtml(walletHeld)}</strong></div>
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

    async function loadBuyerConversations(container) {
        if (!container) {
            return;
        }

        container.innerHTML = "<p class=\"empty-state\">Loading your conversations...</p>";

        const data = await apiRequest("/listings/conversations", {}, true);
        const threads = Array.isArray(data.threads) ? data.threads : [];

        if (threads.length === 0) {
            container.innerHTML = "<p class=\"empty-state\">No conversations yet. Message a seller to start chatting.</p>";
            return;
        }

        container.innerHTML = threads
            .map((thread) => {
                const lastBody = thread.lastMessage && thread.lastMessage.body ? thread.lastMessage.body : "";
                const lastTime =
                    thread.lastMessage && thread.lastMessage.createdAt
                        ? formatRelativeTime(thread.lastMessage.createdAt)
                        : "recent";
                const lastDirection =
                    thread.lastMessage && thread.lastMessage.fromSeller ? "Seller replied" : "You sent";

                return `
                    <article class="inbox-item">
                        <div class="inbox-top">
                            <p class="inbox-title">${escapeHtml(thread.title || "Listing")}</p>
                            <div class="meta-chips">
                                <span class="chip">${escapeHtml(thread.availability || "available")}</span>
                            </div>
                        </div>
                        <p class="inbox-meta">Seller: ${escapeHtml(thread.sellerName || "Seller")} · ${escapeHtml(
                    thread.location || "Unknown location"
                )}</p>
                        <p class="inbox-meta">${escapeHtml(lastDirection)} · ${escapeHtml(lastTime)}</p>
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

    async function sendConversationReply(listingId, message) {
        const response = await apiRequest(
            `/listings/${listingId}/messages`,
            {
                method: "POST",
                body: { message }
            },
            true
        );

        showToast(response.message || "Reply sent.", "success");
    }

    async function loadNotifications(container, badgeElement) {
        if (!container) {
            return;
        }

        container.innerHTML = "<p class=\"empty-state\">Loading notifications...</p>";
        const data = await apiRequest("/notifications", {}, true);
        const notifications = Array.isArray(data.notifications) ? data.notifications : [];
        const unreadCount = Number(data.unreadCount || 0);

        if (badgeElement) {
            badgeElement.textContent = `Unread: ${unreadCount}`;
            badgeElement.className = unreadCount > 0 ? "badge badge-warning" : "badge badge-approved";
        }

        if (!notifications.length) {
            container.innerHTML = "<p class=\"empty-state\">No notifications yet.</p>";
            return;
        }

        container.innerHTML = notifications
            .map((notification) => {
                const type = String(notification.type || "system").trim().toLowerCase();
                const title = String(notification.title || "Notification").trim();
                const body = String(notification.body || "").trim();
                const isUnread = !notification.read;
                const meta = notification.meta || {};

                const metaBits = [];
                if (meta.listingId) {
                    metaBits.push(`Listing #${String(meta.listingId).slice(-6)}`);
                }
                if (meta.escrowId) {
                    metaBits.push(`Escrow #${String(meta.escrowId).slice(-6)}`);
                }
                if (meta.messageId) {
                    metaBits.push(`Msg #${String(meta.messageId).slice(-6)}`);
                }

                const typeChip =
                    type === "escrow"
                        ? "<span class=\"chip chip-warning\">Escrow</span>"
                        : type === "offer"
                        ? "<span class=\"chip\">Offer</span>"
                        : type === "wallet"
                        ? "<span class=\"chip chip-verified\">Wallet</span>"
                        : "<span class=\"chip\">System</span>";

                return `
                    <article class="inbox-item ${isUnread ? "unread" : ""}">
                        <div class="inbox-top">
                            <p class="inbox-title">${escapeHtml(title)}</p>
                            <div class="meta-chips">
                                ${typeChip}
                                <span class="chip">${escapeHtml(formatRelativeTime(notification.createdAt))}</span>
                                ${isUnread ? "<span class=\"chip chip-warning\">Unread</span>" : ""}
                            </div>
                        </div>
                        <p class="card-hint">${escapeHtml(body)}</p>
                        ${
                            metaBits.length
                                ? `<p class="inbox-meta">${escapeHtml(metaBits.join(" | "))}</p>`
                                : ""
                        }
                        <div class="card-actions">
                            ${
                                isUnread
                                    ? `<button class="btn btn-secondary" type="button" data-notification-id="${escapeHtml(
                                          notification._id
                                      )}">Mark Read</button>`
                                    : "<span class=\"chip chip-verified\">Read</span>"
                            }
                        </div>
                    </article>
                `;
            })
            .join("");
    }

    async function markNotificationRead(notificationId) {
        await apiRequest(
            `/notifications/${notificationId}/read`,
            {
                method: "PATCH"
            },
            true
        );
    }

    async function markAllNotificationsRead() {
        await apiRequest(
            "/notifications/read-all",
            {
                method: "PATCH"
            },
            true
        );
    }

    async function loadWalletTransactions(container) {
        if (!container) {
            return;
        }

        container.innerHTML = "<p class=\"empty-state\">Loading wallet activity...</p>";
        const data = await apiRequest("/escrow/wallet/transactions?limit=20", {}, true);
        const transactions = Array.isArray(data.transactions) ? data.transactions : [];

        if (!transactions.length) {
            container.innerHTML =
                "<p class=\"empty-state\">No wallet activity yet. Top up wallet or use escrow to see entries here.</p>";
            return;
        }

        container.innerHTML = transactions
            .map((entry) => {
                const type = String(entry.type || "adjustment").trim().toLowerCase();
                const amount = Number(entry.amount || 0);
                const amountLabel = `${amount >= 0 ? "+" : ""}${formatCurrency(amount)}`;
                const balanceLabel = formatCurrency(Number(entry.balanceAfter || 0));
                const typeLabel = type.replace(/_/g, " ");

                return `
                    <article class="inbox-item">
                        <div class="inbox-top">
                            <p class="inbox-title">${escapeHtml(typeLabel)}</p>
                            <div class="meta-chips">
                                <span class="chip ${amount >= 0 ? "chip-verified" : "chip-warning"}">${escapeHtml(
                    amountLabel
                )}</span>
                                <span class="chip">${escapeHtml(formatRelativeTime(entry.createdAt))}</span>
                            </div>
                        </div>
                        <p class="inbox-meta">Balance after: ${escapeHtml(balanceLabel)}</p>
                        ${
                            entry.note
                                ? `<p class="card-hint">${escapeHtml(entry.note)}</p>`
                                : ""
                        }
                    </article>
                `;
            })
            .join("");
    }

    async function loadEscrowDeals(container) {
        if (!container) {
            return;
        }

        container.innerHTML = "<p class=\"empty-state\">Loading secure hold deals...</p>";

        const data = await apiRequest("/escrow/mine", {}, true);
        const escrows = Array.isArray(data.escrows) ? data.escrows : [];

        if (!escrows.length) {
            container.innerHTML =
                "<p class=\"empty-state\">No escrow deals yet. Use Secure Hold on a listing to start protected trading.</p>";
            return;
        }

        container.innerHTML = escrows
            .map((escrow) => {
                const listingTitle =
                    escrow.listing && escrow.listing.title ? escrow.listing.title : "Listing";
                const listingLocation =
                    escrow.listing && escrow.listing.location ? escrow.listing.location : "Unknown location";
                const status = String(escrow.status || "").toLowerCase();
                const buyerId = escrow.buyer && (escrow.buyer._id || escrow.buyer);
                const isBuyer = String(buyerId || "") === String(state.user && state.user._id);
                const roleLabel = isBuyer ? "Buyer" : "Seller";
                const buyerName = escrow.buyer && escrow.buyer.name ? escrow.buyer.name : "Buyer";
                const sellerName = escrow.seller && escrow.seller.name ? escrow.seller.name : "Seller";
                const counterpartLabel = isBuyer ? `Seller: ${sellerName}` : `Buyer: ${buyerName}`;
                const amount = formatCurrency(escrow.amount || 0);
                const fee = formatCurrency(escrow.serviceFee || 0);
                const totalHeld = formatCurrency(escrow.totalHeld || 0);

                let actions = "";
                if (!isBuyer && status === "funded") {
                    actions += `<button class="btn btn-secondary" type="button" data-escrow-action="ship" data-id="${escapeHtml(
                        escrow._id
                    )}">Mark Shipped</button>`;
                }
                if (isBuyer && status === "shipped") {
                    actions += `<button class="btn btn-success" type="button" data-escrow-action="confirm" data-id="${escapeHtml(
                        escrow._id
                    )}">Confirm Delivery</button>`;
                }
                if (isBuyer && status === "funded") {
                    actions += `<button class="btn btn-danger" type="button" data-escrow-action="cancel" data-id="${escapeHtml(
                        escrow._id
                    )}">Cancel & Refund</button>`;
                }
                if (["funded", "shipped"].includes(status)) {
                    actions += `<button class="btn btn-secondary" type="button" data-escrow-action="dispute" data-id="${escapeHtml(
                        escrow._id
                    )}">Open Dispute</button>`;
                }

                return `
                    <article class="inbox-item">
                        <div class="inbox-top">
                            <p class="inbox-title">${escapeHtml(listingTitle)}</p>
                            <div class="meta-chips">
                                <span class="chip">${escapeHtml(roleLabel)}</span>
                                <span class="chip chip-warning">${escapeHtml(status)}</span>
                            </div>
                        </div>
                        <p class="inbox-meta">${escapeHtml(listingLocation)} · Updated ${escapeHtml(
                    formatRelativeTime(escrow.updatedAt)
                )}</p>
                        <div class="listing-meta">
                            <span>${escapeHtml(counterpartLabel)}</span>
                            <span>Status: ${escapeHtml(status)}</span>
                        </div>
                        <div class="listing-meta">
                            <span>Item: ${escapeHtml(amount)}</span>
                            <span>Fee: ${escapeHtml(fee)}</span>
                        </div>
                        <div class="listing-meta">
                            <span>Total Held: ${escapeHtml(totalHeld)}</span>
                            <span>Resolution: ${escapeHtml(escrow.resolution || "none")}</span>
                        </div>
                        ${actions ? `<div class="card-actions">${actions}</div>` : ""}
                    </article>
                `;
            })
            .join("");
    }

    async function runEscrowAction(escrowId, action) {
        if (action === "ship") {
            const response = await apiRequest(
                `/escrow/${escrowId}/ship`,
                {
                    method: "PATCH"
                },
                true
            );
            showToast(response.message || "Escrow marked as shipped.", "success");
            return;
        }

        if (action === "confirm") {
            const proceed = window.confirm(
                "Confirm delivery? This releases held funds to the seller and marks the deal complete."
            );
            if (!proceed) {
                return;
            }

            const response = await apiRequest(
                `/escrow/${escrowId}/confirm`,
                {
                    method: "PATCH"
                },
                true
            );
            applyWalletToCurrentUser(response.buyerWallet || response.sellerWallet);
            showToast(response.message || "Funds released to seller.", "success");
            return;
        }

        if (action === "cancel") {
            const proceed = window.confirm("Cancel this escrow and refund the held money?");
            if (!proceed) {
                return;
            }

            const response = await apiRequest(
                `/escrow/${escrowId}/cancel`,
                {
                    method: "PATCH"
                },
                true
            );
            applyWalletToCurrentUser(response.buyerWallet);
            showToast(response.message || "Escrow cancelled and refunded.", "success");
            return;
        }

        if (action === "dispute") {
            const reason = window.prompt(
                "Describe the problem for admin review (5+ characters):",
                "Item not delivered as agreed."
            );
            if (reason === null) {
                return;
            }

            const response = await apiRequest(
                `/escrow/${escrowId}/dispute`,
                {
                    method: "PATCH",
                    body: { reason: reason.trim() }
                },
                true
            );
            showToast(response.message || "Dispute opened.", "success");
        }
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
                    <span>Risk: ${escapeHtml(String(listing.riskLevel || "low"))}</span>
                    <span>Score: ${escapeHtml(String(listing.riskScore || 0))}</span>
                </div>
                <div class="listing-meta">
                    <span>Phone: ${escapeHtml(formatPhone(listing.contactPhone))}</span>
                    <span>Views: ${escapeHtml(String(listing.viewsCount || 0))}</span>
                </div>
                <div class="card-actions">
                    <button class="btn btn-secondary" type="button" data-action="view-messages" data-id="${escapeHtml(listing._id)}">
                        View Messages
                    </button>
                    <button class="btn btn-danger" type="button" data-action="delete-listing" data-id="${escapeHtml(listing._id)}">
                        Remove Listing
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

        panel.dataset.listingId = listingId;
        panel.innerHTML = "<p class=\"muted\">Loading messages...</p>";

        const data = await apiRequest(`/listings/${listingId}/messages`, {}, true);
        const messages = Array.isArray(data.messages) ? data.messages : [];
        const isSeller = !!data.isSeller;
        const canReply = !!data.canReply;

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

        const messageHtml = messages
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
                const offerStatus = String(message.offerStatus || "").trim().toLowerCase();
                const contactInfo = [senderEmail, senderPhone, senderCity]
                    .filter((value) => String(value || "").trim())
                    .join(" | ");
                const offerStatusChip =
                    message.type === "offer"
                        ? `<span class="chip ${
                              offerStatus === "accepted"
                                  ? "chip-verified"
                                  : offerStatus === "rejected"
                                  ? "chip-warning"
                                  : "chip"
                          }">${escapeHtml(offerStatus || "pending")}</span>`
                        : "";
                const canDecideOffer =
                    isSeller &&
                    message.type === "offer" &&
                    offerStatus === "pending" &&
                    String(message.messageId || "").trim();
                const offerActions = canDecideOffer
                    ? `
                        <div class="card-actions">
                            <button
                                class="btn btn-success"
                                type="button"
                                data-offer-decision="accepted"
                                data-message-id="${escapeHtml(String(message.messageId || ""))}"
                            >
                                Accept Offer
                            </button>
                            <button
                                class="btn btn-danger"
                                type="button"
                                data-offer-decision="rejected"
                                data-message-id="${escapeHtml(String(message.messageId || ""))}"
                            >
                                Reject Offer
                            </button>
                        </div>
                    `
                    : "";

                return `
                    <article class="message-item">
                        <p class="message-meta">${escapeHtml(senderName)} · ${formatRelativeTime(
                    message.createdAt
                )}${offerTag}</p>
                        ${
                            offerStatusChip
                                ? `<div class="meta-chips">${offerStatusChip}</div>`
                                : ""
                        }
                        ${
                            contactInfo
                                ? `<p class="message-meta">Contact: ${escapeHtml(contactInfo)}</p>`
                                : ""
                        }
                        <p class="message-text">${escapeHtml(message.body)}</p>
                        ${offerActions}
                    </article>
                `;
            })
            .join("");

        const replyBox = canReply
            ? `
                <form class="message-reply-form" data-reply-form data-listing-id="${escapeHtml(listingId)}">
                    <label class="message-reply-label">
                        Send Reply
                        <textarea
                            name="replyMessage"
                            rows="3"
                            maxlength="500"
                            placeholder="${escapeHtml(
                                isSeller
                                    ? "Reply to the buyer..."
                                    : "Reply to the seller..."
                            )}"
                            required
                        ></textarea>
                    </label>
                    <div class="card-actions">
                        <button class="btn btn-primary" type="submit">Send Reply</button>
                    </div>
                </form>
            `
            : "";

        panel.innerHTML = `${messageHtml}${replyBox}`;
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

    async function removeListing(listingId) {
        const proceed = window.confirm(
            "Remove this listing? This action cannot be undone once completed."
        );
        if (!proceed) {
            return;
        }

        const response = await apiRequest(
            `/listings/${listingId}`,
            {
                method: "DELETE"
            },
            true
        );

        showToast(response.message || "Listing removed.", "success");
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
        const escrowDisputeRows = document.getElementById("escrowDisputeRows");
        const notificationList = document.getElementById("notificationList");
        const notificationBadge = document.getElementById("notificationBadge");
        const markAllNotificationsBtn = document.getElementById("markAllNotificationsBtn");
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
                await loadNotifications(notificationList, notificationBadge);
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

            const adminAction = button.dataset.adminAction;
            const listingId = button.dataset.id;
            const nextStatus = button.dataset.status;

            if (!listingId) {
                return;
            }

            if (adminAction === "status" && nextStatus) {
                await moderateListing(listingId, nextStatus);
            }

            if (adminAction === "delete") {
                await removeListing(listingId);
                await refreshAdminData();
            }
        });

        adminListings.addEventListener("click", async (event) => {
            const button = event.target.closest("button[data-admin-action]");
            if (!button) {
                return;
            }

            const adminAction = button.dataset.adminAction;
            const listingId = button.dataset.id;
            const nextStatus = button.dataset.status;

            if (!listingId) {
                return;
            }

            if (adminAction === "status" && nextStatus) {
                await moderateListing(listingId, nextStatus);
            }

            if (adminAction === "delete") {
                await removeListing(listingId);
                await refreshAdminData();
            }
        });

        if (escrowDisputeRows) {
            escrowDisputeRows.addEventListener("click", async (event) => {
                const button = event.target.closest("button[data-escrow-admin-action]");
                if (!button) {
                    return;
                }

                const escrowId = button.dataset.id;
                const resolution = button.dataset.resolution;
                if (!escrowId || !resolution) {
                    return;
                }

                try {
                    await resolveEscrowDispute(escrowId, resolution);
                    await loadEscrowDisputes();
                    await refreshAdminData();
                } catch (error) {
                    showToast(error.message || "Escrow resolution failed.", "error");
                }
            });
        }

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

        if (notificationList) {
            notificationList.addEventListener("click", async (event) => {
                const button = event.target.closest("button[data-notification-id]");
                if (!button) {
                    return;
                }
                const notificationId = String(button.dataset.notificationId || "").trim();
                if (!notificationId) {
                    return;
                }

                try {
                    await markNotificationRead(notificationId);
                    await loadNotifications(notificationList, notificationBadge);
                } catch (error) {
                    showToast(error.message || "Could not update notification.", "error");
                }
            });
        }

        if (markAllNotificationsBtn) {
            markAllNotificationsBtn.addEventListener("click", async () => {
                try {
                    await markAllNotificationsRead();
                    await loadNotifications(notificationList, notificationBadge);
                } catch (error) {
                    showToast(error.message || "Could not mark notifications as read.", "error");
                }
            });
        }

        await refreshAdminData();
        await loadNotifications(notificationList, notificationBadge);
    }

    async function refreshAdminData() {
        const tasks = [
            loadAnalytics(),
            loadPendingListings(),
            loadAdminListings((document.getElementById("adminStatusFilter") || {}).value || ""),
            loadReports(),
            loadEscrowDisputes()
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
            <article class="metric"><h3>Total Escrows</h3><p>${escapeHtml(String(data.totalEscrows || 0))}</p></article>
            <article class="metric"><h3>Escrow Disputes</h3><p>${escapeHtml(String(data.disputedEscrows || 0))}</p></article>
            <article class="metric"><h3>Escrow Released</h3><p>${escapeHtml(String(data.releasedEscrows || 0))}</p></article>
            <article class="metric"><h3>Escrow Held</h3><p>${escapeHtml(
                formatCurrency(data.activeEscrowHeld || 0)
            )}</p></article>
            <article class="metric"><h3>Pending</h3><p>${escapeHtml(String(data.pendingListings || 0))}</p></article>
            <article class="metric"><h3>Approved</h3><p>${escapeHtml(String(data.approvedListings || 0))}</p></article>
            <article class="metric"><h3>Rejected</h3><p>${escapeHtml(String(data.rejectedListings || 0))}</p></article>
            <article class="metric"><h3>Sold</h3><p>${escapeHtml(String(data.soldListings || 0))}</p></article>
            <article class="metric"><h3>Flagged</h3><p>${escapeHtml(String(data.flaggedListings || 0))}</p></article>
            <article class="metric"><h3>High Risk</h3><p>${escapeHtml(String(data.highRiskListings || 0))}</p></article>
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

    async function loadEscrowDisputes() {
        const tableBody = document.getElementById("escrowDisputeRows");
        if (!tableBody) {
            return;
        }

        tableBody.innerHTML = "<tr><td colspan=\"7\">Loading escrow disputes...</td></tr>";

        const data = await apiRequest("/escrow/admin/disputes", {}, true);
        const escrows = Array.isArray(data.escrows) ? data.escrows : [];

        if (!escrows.length) {
            tableBody.innerHTML = "<tr><td colspan=\"7\">No escrow disputes at the moment.</td></tr>";
            return;
        }

        tableBody.innerHTML = escrows
            .map((escrow) => {
                const listingTitle =
                    escrow.listing && escrow.listing.title ? escrow.listing.title : "Unknown listing";
                const buyerName = escrow.buyer && escrow.buyer.name ? escrow.buyer.name : "Unknown buyer";
                const sellerName = escrow.seller && escrow.seller.name ? escrow.seller.name : "Unknown seller";
                const reason = escrow.disputeReason || "No reason provided";

                return `
                    <tr>
                        <td>${escapeHtml(formatDate(escrow.updatedAt || escrow.createdAt))}</td>
                        <td>${escapeHtml(listingTitle)}</td>
                        <td>${escapeHtml(buyerName)}</td>
                        <td>${escapeHtml(sellerName)}</td>
                        <td>${escapeHtml(formatCurrency(escrow.totalHeld || 0))}</td>
                        <td>${escapeHtml(truncate(reason, 140))}</td>
                        <td class="table-actions">
                            <button class="btn btn-success" data-escrow-admin-action="resolve" data-resolution="release_to_seller" data-id="${escapeHtml(
                                escrow._id
                            )}">Release to Seller</button>
                            <button class="btn btn-danger" data-escrow-admin-action="resolve" data-resolution="refund_to_buyer" data-id="${escapeHtml(
                                escrow._id
                            )}">Refund Buyer</button>
                        </td>
                    </tr>
                `;
            })
            .join("");
    }

    async function resolveEscrowDispute(escrowId, resolution) {
        let note = "";
        if (resolution === "release_to_seller") {
            note = window.prompt(
                "Optional moderation note for releasing funds to seller:",
                "Item evidence reviewed. Funds released."
            );
        } else {
            note = window.prompt(
                "Optional moderation note for refunding buyer:",
                "Dispute evidence reviewed. Buyer refunded."
            );
        }

        const response = await apiRequest(
            `/escrow/${escrowId}/resolve`,
            {
                method: "PATCH",
                body: {
                    resolution,
                    note: note || ""
                }
            },
            true
        );

        showToast(response.message || "Escrow dispute resolved.", "success");
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
                        <td>${escapeHtml(String(user.reputationScore || 0))}<br><span class="muted">A: ${escapeHtml(
                    formatCurrency(user.walletBalance || 0)
                )} | H: ${escapeHtml(formatCurrency(user.walletHeldBalance || 0))}</span></td>
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
        if (String(listing.listingType || "").toLowerCase() === "service") {
            chips.push("<span class=\"chip\">Service</span>");
        }
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
        if (String(listing.riskLevel || "").toLowerCase() === "high") {
            chips.push("<span class=\"chip chip-warning\">High Risk</span>");
        } else if (String(listing.riskLevel || "").toLowerCase() === "medium") {
            chips.push("<span class=\"chip\">Medium Risk</span>");
        }

        let moderationButtons = "";
        if (listing.status === "pending") {
            moderationButtons = `
                <button type="button" class="btn btn-success" data-admin-action="status" data-status="approved" data-id="${escapeHtml(listing._id)}">Approve</button>
                <button type="button" class="btn btn-danger" data-admin-action="status" data-status="rejected" data-id="${escapeHtml(listing._id)}">Reject</button>
            `;
        }

        if (listing.status === "approved") {
            moderationButtons = `
                <button type="button" class="btn btn-danger" data-admin-action="status" data-status="rejected" data-id="${escapeHtml(listing._id)}">Reject</button>
            `;
        }

        if (listing.status === "rejected") {
            moderationButtons = `
                <button type="button" class="btn btn-success" data-admin-action="status" data-status="approved" data-id="${escapeHtml(listing._id)}">Approve</button>
            `;
        }

        const actions = `
            <div class="card-actions">
                ${moderationButtons}
                <button type="button" class="btn btn-danger" data-admin-action="delete" data-id="${escapeHtml(listing._id)}">Remove Listing</button>
            </div>
        `;

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
                    <span>Risk: ${escapeHtml(String(listing.riskLevel || "low"))}</span>
                    <span>Score: ${escapeHtml(String(listing.riskScore || 0))}</span>
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
