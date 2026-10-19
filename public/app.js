// Render API data as text: record names and titles are untrusted input.
function showResults(container, title, data) {
    const heading = document.createElement("h3");
    heading.textContent = title;
    const pre = document.createElement("pre");
    pre.textContent = JSON.stringify(data, null, 2);
    container.replaceChildren(heading, pre);
}

async function readApi(url) {
    const response = await fetch(url);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Unable to load results.");
    return data;
}

let collaborationNetwork = null;

async function loadPageRank() {
    const result = document.getElementById("result");

    result.innerHTML = "Loading PageRank...";

    try {
        const data = await readApi("/api/graph/pagerank");

        showResults(result, "PageRank Results", data);
    } catch (error) {
        result.innerHTML = "Error loading PageRank.";
        console.error(error);
    }
}

async function loadCommunities() {
    const result = document.getElementById("result");

    result.innerHTML = "Loading communities...";

    try {
        const data = await readApi("/api/graph/communities");

        showResults(result, "Community Detection Results", data);
    } catch (error) {
        result.innerHTML = "Error loading communities.";
        console.error(error);
    }
}
async function loadShortestPath() {
    const result = document.getElementById("result");

    const from = document.getElementById("fromAuthor").value.trim();
    const to = document.getElementById("toAuthor").value.trim();

    if (!from || !to) {
        result.innerHTML = "Please enter both Author IDs.";
        return;
    }

    result.innerHTML = "Finding shortest path...";

    try {
        const data = await readApi(
            `/api/graph/shortest-path?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
        );

        showResults(result, "Shortest Collaboration Path", data);
    } catch (error) {
        result.innerHTML = "Error finding shortest path.";
        console.error(error);
    }
}
async function loadGraph() {
    const graph = document.getElementById("graph");

    if (collaborationNetwork) collaborationNetwork.destroy();
    collaborationNetwork = null;
    graph.textContent = "Loading collaboration graph...";

    try {
        const data = await readApi("/api/graph/network");

        if (!data.nodes || data.nodes.length === 0) {
            graph.innerHTML = "No graph data available.";
            return;
        }

        graph.innerHTML = "";

        // Create nodes
        const nodes = new vis.DataSet(
            data.nodes.map((author) => ({
                id: author.id,
                label: author.name,
                title: Object.assign(document.createElement("span"), {textContent: `Author: ${author.name}`}),
                shape: "dot",
                size: 18
            }))
        );

        // Create relationships
        const edges = new vis.DataSet(
    data.edges.map((edge, index) => {
        const weight = Number(edge.weight) || 1;

        return {
            id: index,
            from: edge.a,
            to: edge.b,
            label: String(weight),
            title: `Shared papers: ${weight}`,
            width: Math.max(1, weight)
        };
    })
);
        const networkData = {
            nodes: nodes,
            edges: edges
        };

        const options = {
            nodes: {
                font: {
                    size: 14
                }
            },

            edges: {
                smooth: true,
                arrows: {
                    to: {
                        enabled: false
                    }
                }
            },

            physics: {
    enabled: true,
    stabilization: {
        enabled: true,
        iterations: 200,
        fit: true
    }
},

            interaction: {
                hover: true,
                navigationButtons: true,
                zoomView: true,
                dragView: true
            }
        };

        const network = collaborationNetwork = new vis.Network(
            graph,
            networkData,
            options
        );
        network.once("stabilizationIterationsDone", function () {
    network.setOptions({
        physics: {
            enabled: false
        }
    });
});

        network.on("click", function (params) {
            if (params.nodes.length > 0) {
                const nodeId = params.nodes[0];
                const author = data.nodes.find(
                    (node) => node.id === nodeId
                );

                if (author) {
                    alert(`Author: ${author.name}`);
                }
            }
        });

    } catch (error) {
        graph.innerHTML = "Error loading collaboration graph.";
        console.error(error);
    }
}
async function loadAnalytics(type) {
    const result = document.getElementById("analyticsResult");

    result.innerHTML = "Loading analytics...";

    try {
        const data = await readApi(`/api/analytics/${type}`);
        showResults(result, type.replaceAll("-", " "), data);

    } catch (error) {
        result.innerHTML = "Error connecting to analytics API.";
        console.error(error);
    }
}

/* ==========================================
   SCHOLARZZONE CRUD
   Authors, Institutions and Publications
   ========================================== */

let crudToken = null;
let editingRecordId = null;
let crudViewVersion = 0;

const crudConfig = {
    authors: {
        label: "Author",
        endpoint: "/api/authors"
    },
    institutions: {
        label: "Institution",
        endpoint: "/api/institutions"
    },
    publications: {
        label: "Publication",
        endpoint: "/api/publications"
    }
};

// Show a message safely
function showCrudMessage(message, isError = false) {
    const box = document.getElementById("crudMessage");
    if (!box) return;

    box.textContent = message;
    box.style.color = isError ? "#c62828" : "#218838";
}

// Make an API request

async function crudRequest(url, options = {}) {
    const headers = {
        "Content-Type": "application/json",
        ...(options.headers || {})
    };

    if (crudToken) {
        headers.Authorization = `Bearer ${crudToken}`;
    }

    let response;

    try {
        response = await fetch(url, {
            ...options,
            headers
        });
    } catch {
        throw new Error(
            "Cannot connect to Scholarzzone. Please check that the server is running and try again."
        );
    }

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        if (response.status === 401) {
            if (url === "/api/auth/login") {
                throw new Error("Incorrect email or password. Please try again.");
            }
            clearCrudSession();
            throw new Error("Your session has expired. Please log in again.");
        }

        if (response.status === 400 || response.status === 422) {
            throw new Error(
                data.error ||
                data.message ||
                "Some information is invalid. Please check the fields and try again."
            );
        }

        if (response.status === 404) {
            throw new Error(
                data.error ||
                "The requested record could not be found. It may have been deleted."
            );
        }

        if (response.status === 409) {
            throw new Error(
                data.error ||
                "This record already exists. Please check for duplicate information."
            );
        }

        if (response.status >= 500) {
            throw new Error(
                "The server encountered a problem. Please try again in a moment."
            );
        }

        throw new Error(
            data.error ||
            data.message ||
            "Something went wrong. Please check your input and try again."
        );
    }

    return data;
}


function clearCrudSession() {
    crudToken = null;
    editingRecordId = null;
    crudViewVersion++;
    document.getElementById("crudFormContainer").replaceChildren();
    document.getElementById("crudRecords").textContent = "Please log in to manage records.";
    renderCrudLogin();
}

function requireCrudLogin() {
    if (crudToken) return true;
    showCrudMessage("Please log in to manage records.", true);
    document.getElementById("crudEmail")?.focus();
    return false;
}

// Fetch every page so records and relationship choices are never silently omitted.
async function allCrudRecords(endpoint) {
    const records = [];
    for (let page = 1; ; page++) {
        const data = await crudRequest(`${endpoint}?page=${page}&limit=100`);
        const batch = data.results || [];
        records.push(...batch);
        if (!batch.length || records.length >= data.total) return records;
    }
}

// Create the login area dynamically.
// No credentials or tokens are saved in localStorage.
function renderCrudLogin() {
    const section = document.getElementById("crudSection");
    if (!section) return;

    let loginArea = document.getElementById("crudLoginArea");

    if (!loginArea) {
        loginArea = document.createElement("div");
        loginArea.id = "crudLoginArea";
        section.insertBefore(loginArea, section.firstChild);
    }

    loginArea.replaceChildren();

    const heading = document.createElement("h3");
    heading.textContent = "Admin Login";
    loginArea.appendChild(heading);

    if (crudToken) {
        const status = document.createElement("p");
        status.textContent = "Logged in as admin.";
        loginArea.appendChild(status);

        const logoutButton = document.createElement("button");
        logoutButton.type = "button";
        logoutButton.textContent = "Logout";
        logoutButton.addEventListener("click", () => {
            clearCrudSession();
            showCrudMessage("You have logged out.");
            renderCrudLogin();
        });

        loginArea.appendChild(logoutButton);
        return;
    }

    const form = document.createElement("form");
    form.id = "crudLoginForm";

    form.innerHTML = `
        <label for="crudEmail">Admin email</label>
        <input id="crudEmail" type="email" required
               autocomplete="username" placeholder="Enter admin email">

        <label for="crudPassword">Password</label>
        <input id="crudPassword" type="password" required
               autocomplete="current-password" placeholder="Enter password">

        <button type="submit">Login</button>
    `;

    form.addEventListener("submit", async (event) => {
        event.preventDefault();

        const email = document.getElementById("crudEmail").value.trim();
        const password = document.getElementById("crudPassword").value;

        try {
            showCrudMessage("Logging in...");

            const result = await crudRequest("/api/auth/login", {
                method: "POST",
                body: JSON.stringify({ email, password })
            });

            crudToken = result.token;

            if (!crudToken) {
                throw new Error("Login succeeded but no token was returned.");
            }

            form.reset();
            renderCrudLogin();
            showCrudMessage("Login successful. You can now manage records.");
            await loadRecords();
        } catch (error) {
            showCrudMessage(error.message, true);
        }
    });

    loginArea.appendChild(form);
}

// Create a labelled form field
function addCrudField(form, labelText, id, type = "text", required = true) {
    const label = document.createElement("label");
    label.htmlFor = id;
    label.textContent = labelText;

    const input = document.createElement(
        type === "textarea" || type === "select" ? type : "input"
    );

    input.id = id;
    input.name = id;

    if (type !== "textarea" && type !== "select") {
        input.type = type;
    }

    input.required = required;

    if (type === "textarea") {
        input.rows = 4;
    }

    form.append(label, input);
    return input;
}

// Populate a dropdown from an API endpoint
async function fillCrudDropdown(select, endpoint, placeholder, valueField, labelField) {
    const records = await allCrudRecords(endpoint);

    select.replaceChildren();

    const firstOption = document.createElement("option");
    firstOption.value = "";
    firstOption.textContent = placeholder;
    firstOption.disabled = true;
    select.appendChild(firstOption);

    records.forEach((record) => {
        const option = document.createElement("option");
        option.value = record[valueField];
        option.textContent = record[labelField];
        select.appendChild(option);
    });

    return records;
}

// Build the correct form for the selected record type
async function renderCrudForm(record = null) {
    if (!requireCrudLogin()) return;
    try {
        await buildCrudForm(record);
    } catch (error) {
        showCrudMessage(error.message, true);
    }
}

async function buildCrudForm(record = null) {
    const version = ++crudViewVersion;
    const type = document.getElementById("crudEntity").value;
    const container = document.getElementById("crudFormContainer");

    container.replaceChildren();
    editingRecordId = record ? record._id : null;

    const heading = document.createElement("h3");
    heading.textContent = record
        ? `Edit ${crudConfig[type].label}`
        : `Add ${crudConfig[type].label}`;

    const form = document.createElement("form");
    form.id = "crudDataForm";

    const fields = {};

    if (type === "institutions") {
        fields.name = addCrudField(form, "Institution name", "name");
        fields.country = addCrudField(form, "Country", "country");

        fields.type = addCrudField(form, "Institution type", "type", "select");
        ["University", "Research Lab", "Industry"].forEach((value) => {
            const option = document.createElement("option");
            option.value = value;
            option.textContent = value;
            fields.type.appendChild(option);
        });
    }

    if (type === "authors") {
        fields.name = addCrudField(form, "Author name", "name");
        fields.email = addCrudField(form, "Email", "email", "email");
        fields.institutionId = addCrudField(
            form, "Institution", "institutionId", "select"
        );
        fields.bio = addCrudField(form, "Bio (optional)", "bio", "textarea", false);

        await fillCrudDropdown(
            fields.institutionId,
            "/api/institutions",
            "Select an institution",
            "_id",
            "name"
        );
    }

    if (type === "publications") {
        fields.title = addCrudField(form, "Title", "title");
        fields.abstract = addCrudField(form, "Abstract", "abstract", "textarea");
        fields.year = addCrudField(form, "Year", "year", "number");
        fields.year.min = 1900;
        fields.year.max = new Date().getFullYear() + 10;
        fields.venue = addCrudField(form, "Venue", "venue");
        fields.keywords = addCrudField(
            form, "Keywords (separate with commas)", "keywords", "textarea", false
        );

        fields.authorIds = addCrudField(
            form, "Authors (select one or more)", "authorIds", "select"
        );
        fields.authorIds.multiple = true;

        await fillCrudDropdown(
            fields.authorIds,
            "/api/authors",
            "Select authors",
            "_id",
            "name"
        );
    }

    // Fill existing values when editing
    if (record) {
        for (const [key, input] of Object.entries(fields)) {
            if (key === "institutionId") {
                input.value = record.institutionId?._id || record.institutionId || "";
            } else if (key === "authorIds") {
                const ids = (record.authorIds || []).map((author) =>
                    typeof author === "object" ? author._id : author
                );

                Array.from(input.options).forEach((option) => {
                    option.selected = ids.includes(option.value);
                });
            } else if (key === "keywords") {
                input.value = Array.isArray(record.keywords)
                    ? record.keywords.join(", ")
                    : "";
            } else {
                input.value = record[key] ?? "";
            }
        }
    }

    const submitButton = document.createElement("button");
    submitButton.type = "submit";
    submitButton.textContent = record ? "Save Changes" : "Add Record";

    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.textContent = "Cancel";
    cancelButton.addEventListener("click", () => {
        editingRecordId = null;
        container.replaceChildren();
        showCrudMessage("Form cancelled.");
    });

    form.append(submitButton, cancelButton);
    if (version !== crudViewVersion || !crudToken) return;
    container.append(heading, form);

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!requireCrudLogin() || submitButton.disabled) return;
        submitButton.disabled = true;

        const payload = {};

        for (const [key, input] of Object.entries(fields)) {
            if (key === "keywords") {
                payload[key] = input.value
                    .split(",")
                    .map((word) => word.trim())
                    .filter(Boolean);
            } else if (key === "authorIds") {
                payload[key] = Array.from(input.selectedOptions)
                    .map((option) => option.value)
                    .filter(Boolean);
            } else if (key === "year") {
                payload[key] = Number(input.value);
            } else {
                payload[key] = input.value.trim();
            }
        }

        try {
            showCrudMessage(record ? "Saving changes..." : "Adding record...");

            const endpoint = crudConfig[type].endpoint;
            const method = record ? "PUT" : "POST";
            const url = record ? `${endpoint}/${record._id}` : endpoint;

            await crudRequest(url, {
                method,
                body: JSON.stringify(payload)
            });

            editingRecordId = null;
            container.replaceChildren();
            showCrudMessage(
                `${crudConfig[type].label} ${record ? "updated" : "added"} successfully.`
            );

            await loadRecords();
        } catch (error) {
            showCrudMessage(error.message, true);
        } finally {
            submitButton.disabled = false;
        }
    });
}

// Read and display records
async function loadRecords() {
    const version = crudViewVersion;
    const type = document.getElementById("crudEntity").value;
    const recordsBox = document.getElementById("crudRecords");

    if (!crudToken) {
        recordsBox.textContent = "Please log in before viewing records.";
        return;
    }

    try {
        showCrudMessage("Loading records...");

        const records = await allCrudRecords(crudConfig[type].endpoint);
        if (version !== crudViewVersion || !crudToken) return;

        recordsBox.replaceChildren();

        if (records.length === 0) {
            recordsBox.textContent = "No records found.";
            showCrudMessage("No records found.");
            return;
        }

        records.forEach((record) => {
            const card = document.createElement("div");
            card.className = "crud-record";

            const title = document.createElement("h4");
            title.textContent =
                record.name || record.title || "Untitled record";
            card.appendChild(title);

            const details = document.createElement("p");

            if (type === "authors") {
                const institution = record.institutionId?.name || "Not specified";
                details.textContent =
                    `Email: ${record.email} | Institution: ${institution}`;
            } else if (type === "institutions") {
                details.textContent =
                    `Country: ${record.country} | Type: ${record.type}`;
            } else {
                details.textContent =
                    `Year: ${record.year} | Venue: ${record.venue}`;
            }

            card.appendChild(details);

            const editButton = document.createElement("button");
            editButton.type = "button";
            editButton.textContent = "Edit";
            editButton.addEventListener("click", async () => {
                try {
                    await renderCrudForm(record);
                    showCrudMessage("Edit the fields and save your changes.");
                } catch (error) {
                    showCrudMessage(error.message, true);
                }
            });

            const deleteButton = document.createElement("button");
            deleteButton.type = "button";
            deleteButton.textContent = "Delete";
            deleteButton.addEventListener("click", () => deleteRecord(record._id));

            card.append(editButton, deleteButton);
            recordsBox.appendChild(card);
        });

        showCrudMessage(`Loaded ${records.length} ${crudConfig[type].label.toLowerCase()} record(s).`);
    } catch (error) {
        recordsBox.textContent = "Could not load records.";
        showCrudMessage(error.message, true);
    }
}

// Delete a record
async function deleteRecord(id) {
    const type = document.getElementById("crudEntity").value;

    if (!crudToken) {
        showCrudMessage("Please log in first.", true);
        return;
    }

    if (!confirm("Are you sure you want to delete this record?")) {
        return;
    }

    try {
        await crudRequest(`${crudConfig[type].endpoint}/${id}`, {
            method: "DELETE"
        });

        showCrudMessage(`${crudConfig[type].label} deleted successfully.`);
        await loadRecords();
    } catch (error) {
        showCrudMessage(error.message, true);
    }
}

// Initialize the CRUD login area
document.addEventListener("DOMContentLoaded", () => {
    if (document.getElementById("crudSection")) {
        renderCrudLogin();
        document.getElementById("crudEntity").addEventListener("change", () => {
            crudViewVersion++;
            editingRecordId = null;
            document.getElementById("crudFormContainer").replaceChildren();
            document.getElementById("crudRecords").replaceChildren();
            if (crudToken) loadRecords();
        });
    }
});
