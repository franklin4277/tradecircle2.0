
(() => {
    const API_BASE = "/api";
    const TOKEN_KEY = "tradecircle_token";
    const USER_CACHE_KEY = "tradecircle_user_cache";
    const state = {
        user: null,
        toastTimer: null
    };

    document.addEventListener("DOMContentLoaded", async () => {
        const page = document.body.dataset.page || "index";

        await hydrateCurrentUser();
        setupNavigation(page);

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

            if (state.user.role === "admin") {
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

        if (user.role === "admin") {
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

    async function initIndexPage() {
        const searchInput = document.getElementById("searchInput");
        const locationFilter = document.getElementById("locationFilter");
        const listingFilterForm = document.getElementById("listingFilterForm");
        const listingGrid = document.getElementById("listingGrid");

        if (!searchInput || !locationFilter || !listingFilterForm || !listingGrid) {
            return;
        }

        const params = new URLSearchParams(window.location.search);
        if (params.get("search")) {
            searchInput.value = params.get("search");
        }

        await loadLocations(locationFilter);

        if (params.get("location")) {
            locationFilter.value = params.get("location");
        }

        await fetchAndRenderListings({
            searchInput,
            locationFilter,
            listingGrid,
            syncUrl: false
        });

        listingFilterForm.addEventListener("submit", async (event) => {
            event.preventDefault();
            await fetchAndRenderListings({
                searchInput,
                locationFilter,
                listingGrid,
                syncUrl: true
            });
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

                if (action === "pay") {
                    await simulatePayment(listingId);
                }
            } catch (error) {
                showToast(error.message || "Action failed.", "error");
            }
        });
    }

    async function loadLocations(selectElement) {
        try {
            const data = await apiRequest("/listings/locations");
            const locations = Array.isArray(data.locations) ? data.locations : [];

            for (const location of locations) {
                const option = document.createElement("option");
                option.value = location;
                option.textContent = location;
                selectElement.appendChild(option);
            }
        } catch {
            // Keep UI usable even if location loading fails.
        }
    }

    async function fetchAndRenderListings({ searchInput, locationFilter, listingGrid, syncUrl }) {
        const params = new URLSearchParams();
        const search = searchInput.value.trim();
        const location = locationFilter.value.trim();

        if (search) {
            params.set("search", search);
        }

        if (location) {
            params.set("location", location);
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

        let actionHtml = "<p class=\"card-hint\">Login to report, message seller, or pay securely.</p>";

        if (state.user && !isOwner) {
            actionHtml = `
                <div class="card-actions">
                    <button type="button" class="btn btn-secondary" data-action="message" data-id="${escapeHtml(listing._id)}">Message</button>
                    <button type="button" class="btn btn-secondary" data-action="report" data-id="${escapeHtml(listing._id)}">Report</button>
                    <button type="button" class="btn btn-primary" data-action="pay" data-id="${escapeHtml(listing._id)}">Pay (M-Pesa)</button>
                </div>
            `;
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
                <div class="listing-meta">
                    <span>${escapeHtml(listing.location)}</span>
                    <span>${formatDate(listing.createdAt)}</span>
                </div>
                <div class="listing-meta">
                    <span>Seller: ${escapeHtml(sellerName)}</span>
                    <span>Rep: ${escapeHtml(String(sellerRep))}</span>
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

        showToast(response.message || "Report sent.", "success");
    }

    async function sendMessage(listingId) {
        if (!ensureAuthenticated()) {
            return;
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

    async function simulatePayment(listingId) {
        if (!ensureAuthenticated()) {
            return;
        }

        const proceed = window.confirm("Simulate M-Pesa payment for this listing?");
        if (!proceed) {
            return;
        }

        const response = await apiRequest(
            `/listings/${listingId}/pay`,
            {
                method: "POST"
            },
            true
        );

        const payment = response.payment || {};
        showToast(
            `Payment success: ${payment.transactionId || "Transaction created"}`,
            "success"
        );
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
            const password = String(formData.get("password") || "");
            const adminSecret = String(formData.get("adminSecret") || "").trim();

            try {
                const data = await apiRequest("/auth/register", {
                    method: "POST",
                    body: { name, email, password, adminSecret }
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

        if (!profileCard || !listingForm || !myListings) {
            return;
        }

        renderProfileCard(profileCard, state.user);

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
            const button = event.target.closest("button[data-action='view-messages']");
            if (!button) {
                return;
            }

            const listingId = button.dataset.id;
            if (!listingId) {
                return;
            }

            try {
                await loadListingMessages(listingId);
            } catch (error) {
                showToast(error.message || "Unable to load messages.", "error");
            }
        });

        if (refreshBtn) {
            refreshBtn.addEventListener("click", async () => {
                await loadMyListings(myListings);
                showToast("Listings refreshed.", "success");
            });
        }

        await loadMyListings(myListings);
    }

    function renderProfileCard(container, user) {
        container.innerHTML = `
            <div class="profile-row"><span>Name</span><strong>${escapeHtml(user.name)}</strong></div>
            <div class="profile-row"><span>Email</span><strong>${escapeHtml(user.email)}</strong></div>
            <div class="profile-row"><span>Role</span><strong>${escapeHtml(user.role)}</strong></div>
            <div class="profile-row"><span>Reputation</span><strong>${escapeHtml(String(user.reputationScore))}</strong></div>
        `;
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

        card.innerHTML = `
            ${imageHtml}
            <div class="listing-body">
                <p class="badge ${getStatusClass(listing.status)}">${escapeHtml(listing.status)}</p>
                <h3 class="listing-title">${escapeHtml(listing.title)}</h3>
                <p class="listing-price">${formatCurrency(listing.price)}</p>
                <p class="listing-description">${escapeHtml(truncate(listing.description, 130))}</p>
                <div class="listing-meta">
                    <span>${escapeHtml(listing.location)}</span>
                    <span>${formatDate(listing.createdAt)}</span>
                </div>
                <div class="listing-meta">
                    <span>Reports: ${escapeHtml(String(listing.reportsCount || 0))}</span>
                    <span>Messages: ${escapeHtml(String(messageCount))}</span>
                </div>
                <div class="card-actions">
                    <button class="btn btn-secondary" type="button" data-action="view-messages" data-id="${escapeHtml(listing._id)}">
                        View Messages
                    </button>
                </div>
            </div>
        `;

        return card;
    }

    async function loadListingMessages(listingId) {
        const panel = document.getElementById("messagePanel");
        if (!panel) {
            return;
        }

        panel.innerHTML = "<p class=\"muted\">Loading messages...</p>";

        const data = await apiRequest(`/listings/${listingId}/messages`, {}, true);
        const messages = Array.isArray(data.messages) ? data.messages : [];

        if (!messages.length) {
            panel.innerHTML = "<p class=\"muted\">No messages yet for this listing.</p>";
            return;
        }

        panel.innerHTML = messages
            .map((message) => {
                const senderName =
                    message.sender && message.sender.name ? message.sender.name : "Marketplace user";

                return `
                    <article class="message-item">
                        <p class="message-meta">${escapeHtml(senderName)} · ${formatDate(message.createdAt)}</p>
                        <p class="message-text">${escapeHtml(message.body)}</p>
                    </article>
                `;
            })
            .join("");
    }

    async function initAdminPage() {
        if (!ensureAuthenticated()) {
            return;
        }

        if (!state.user || state.user.role !== "admin") {
            showToast("Admin access required.", "error");
            setTimeout(() => {
                window.location.href = "dashboard.html";
            }, 500);
            return;
        }

        const refreshBtn = document.getElementById("refreshAdminBtn");
        const statusFilter = document.getElementById("adminStatusFilter");
        const pendingListings = document.getElementById("pendingListings");
        const adminListings = document.getElementById("adminListings");

        if (!pendingListings || !adminListings) {
            return;
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

        await refreshAdminData();
    }

    async function refreshAdminData() {
        await Promise.all([
            loadAnalytics(),
            loadPendingListings(),
            loadAdminListings((document.getElementById("adminStatusFilter") || {}).value || ""),
            loadReports()
        ]);
    }

    async function loadAnalytics() {
        const container = document.getElementById("analyticsCards");
        if (!container) {
            return;
        }

        const data = await apiRequest("/admin/analytics", {}, true);
        container.innerHTML = `
            <article class="metric"><h3>Total Users</h3><p>${escapeHtml(String(data.totalUsers || 0))}</p></article>
            <article class="metric"><h3>Total Listings</h3><p>${escapeHtml(String(data.totalListings || 0))}</p></article>
            <article class="metric"><h3>Total Reports</h3><p>${escapeHtml(String(data.totalReports || 0))}</p></article>
            <article class="metric"><h3>Pending</h3><p>${escapeHtml(String(data.pendingListings || 0))}</p></article>
            <article class="metric"><h3>Approved</h3><p>${escapeHtml(String(data.approvedListings || 0))}</p></article>
            <article class="metric"><h3>Rejected</h3><p>${escapeHtml(String(data.rejectedListings || 0))}</p></article>
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

                return `
                    <tr>
                        <td>${escapeHtml(formatDate(report.createdAt))}</td>
                        <td>${escapeHtml(listingTitle)}</td>
                        <td>${escapeHtml(report.reason || "-")}</td>
                        <td>${escapeHtml(reporter)}</td>
                        <td>${escapeHtml(seller)}</td>
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
                <div class="listing-meta">
                    <span>${escapeHtml(listing.location)}</span>
                    <span>${formatDate(listing.createdAt)}</span>
                </div>
                <div class="listing-meta">
                    <span>${escapeHtml(sellerName)}</span>
                    <span>Rep: ${escapeHtml(String(sellerReputation))}</span>
                </div>
                <div class="listing-meta">
                    <span>${escapeHtml(sellerEmail)}</span>
                    <span>Reports: ${escapeHtml(String(listing.reportsCount || 0))}</span>
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
