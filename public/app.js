async function loadPageRank() {
    const result = document.getElementById("result");

    result.innerHTML = "Loading PageRank...";

    try {
        const response = await fetch("/api/graph/pagerank");
        const data = await response.json();

        result.innerHTML = `
            <h3>PageRank Results</h3>
            <pre>${JSON.stringify(data, null, 2)}</pre>
        `;
    } catch (error) {
        result.innerHTML = "Error loading PageRank.";
        console.error(error);
    }
}

async function loadCommunities() {
    const result = document.getElementById("result");

    result.innerHTML = "Loading communities...";

    try {
        const response = await fetch("/api/graph/communities");
        const data = await response.json();

        result.innerHTML = `
            <h3>Community Detection Results</h3>
            <pre>${JSON.stringify(data, null, 2)}</pre>
        `;
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
        const response = await fetch(
            `/api/graph/shortest-path?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
        );

        const data = await response.json();

        result.innerHTML = `
            <h3>Shortest Collaboration Path</h3>
            <pre>${JSON.stringify(data, null, 2)}</pre>
        `;
    } catch (error) {
        result.innerHTML = "Error finding shortest path.";
        console.error(error);
    }
}
async function loadGraph() {
    const graph = document.getElementById("graph");

    graph.innerHTML = "Loading collaboration graph...";

    try {
        const response = await fetch("/api/graph/network");
        const data = await response.json();

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
                title: `Author: ${author.name}`,
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

        const network = new vis.Network(
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
        const response = await fetch(`/api/analytics/${type}`);
        const data = await response.json();

        if (!response.ok) {
            result.innerHTML = "Error loading analytics.";
            return;
        }

        result.innerHTML = `
            <h3>${type.replaceAll("-", " ")}</h3>
            <pre>${JSON.stringify(data, null, 2)}</pre>
        `;

    } catch (error) {
        result.innerHTML = "Error connecting to analytics API.";
        console.error(error);
    }
}