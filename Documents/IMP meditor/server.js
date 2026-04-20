const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const fs = require('fs');

const mapping = JSON.parse(
    fs.readFileSync('./mapping.json', 'utf8')
);
// 🔧 CONFIG
const DHIS2_BASE_URL = 'https://hispethiopia.org/ati/api';
const USERNAME = 'admin';
const PASSWORD = 'ATI_training2';

// ✅ Data Element Groups (NO PAGING)
app.get('/api/dataElementGroups', async (req, res) => {
    try {
        const response = await axios.get(
            `${DHIS2_BASE_URL}/dataElementGroups?paging=false&fields=id,displayName&order=displayName:asc`,
            { auth: { username: USERNAME, password: PASSWORD } }
        );
        res.json(response.data.dataElementGroups);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ✅ Org Units
app.get('/api/organisationUnits', async (req, res) => {
    try {
        const response = await axios.get(
            `${DHIS2_BASE_URL}/organisationUnits?fields=id,displayName`,
            { auth: { username: USERNAME, password: PASSWORD } }
        );
        res.json(response.data.organisationUnits);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ✅ Analytics with DISAGGREGATION
app.get('/api/analytics', async (req, res) => {
    const { groupId, period, orgUnit } = req.query;

    try {
        const coDimension =
            'lBnoNc1T39R:Mbq12GujYxI;kgXWhJFcw33;Ql3Sy6YjrSN;TLixouvYRPF;SAXhVtAwMEh;pKWpjLWZK0a;snD5u6yDER3';

        const url = `${DHIS2_BASE_URL}/analytics` +
            `?dimension=dx:DE_GROUP-${groupId}` +
            `&dimension=pe:${period}` +
            `&dimension=ou:b3aCK1PTn5S` +
            `&dimension=co:${coDimension}` +
            `&displayProperty=NAME` +
            `&includeMetadataDetails=true`;

        const response = await axios.get(url, {
            auth: { username: USERNAME, password: PASSWORD }
        });

        const { headers, rows, metaData } = response.data;

        const table = rows.map(row => {
            const obj = {};

            headers.forEach((h, i) => {
                let value = row[i];

                if (metaData.items[value]) {
                    value = metaData.items[value].name;
                }

                obj[h.name] = value;
            });

            return obj;
        });

        res.json(table);

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
async function getToken() {
    try {
        const res = await axios.post(
            'https://imp.ati.gov.et:8080/api/auth/token/login/',
            {
                email: 'imp@ati.gov.et',
                password: 'P@ssw0rd!'
            },
            {
                headers: {
                    'Content-Type': 'application/json'
                }
            }
        );

        return res.data.auth_token;

    } catch (err) {
        console.error("❌ Login failed:", err.response?.data || err.message);
        throw new Error("Authentication failed");
    }
}
function transformToPayload(data) {

    if (!Array.isArray(data)) {
        console.error("❌ Data is not an array:", data);
        return [];
    }

    console.log("📊 Incoming rows:", data.length);

    const grouped = {};

    data.forEach(row => {
        console.log("👉 Row:", row);

        if (!row) return;

        const year = row.pe;
        const value = Number(row.value || 0);

        // 🔍 DEBUG co values
        console.log("CO VALUE:", row.co);

        if (row.co !== "Physical-Actual" && row.co !== "Physical-Target") {
            return;
        }

        if (!grouped[year]) {
            grouped[year] = {
                actual: 0,
                target: 0,
                dx: row.dx,
                ou: row.ou
            };
        }

        if (row.co === "Physical-Actual") {
            grouped[year].actual += value;
        }

        if (row.co === "Physical-Target") {
            grouped[year].target += value;
        }
    });

    console.log("📦 Grouped:", grouped);

    const payload = Object.keys(grouped).map(year => {
        const item = grouped[year];

        const implementingUnit = mapping.orgUnits[item.ou];
        const measure = mapping.dataElements[item.dx];

        console.log("🔗 Mapping:", {
            ou: item.ou,
            implementingUnit,
            dx: item.dx,
            measure
        });

        return {
            start_date: `${year}-07-08`,
            end_date: `${Number(year) + 1}-07-07`,
            implementing_unit: implementingUnit,
            project_goal_measure: measure,
            actual: item.actual,
            target: item.target
        };
    });

    console.log("🚀 Final Payload:", payload);

    return payload;
}
// ✅ PUSH TO EXTERNAL SYSTEM
// app.post('/api/pushData', async (req, res) => {
//     try {
//         const rawData = req.body;

//         const period_distributions = transformToPayload(rawData);

//         if (!period_distributions.length) {
//             return res.status(400).json({ error: "No valid data" });
//         }

//         const token = await getToken();

//         const first = period_distributions[0];

//         const baseUrl =
//             'https://imp.ati.gov.et:8080/api/project-goal-measure-unit-distributions/';

//         // 🔍 STEP 1: CHECK EXISTING
//         const existingRes = await axios.get(baseUrl, {
//             headers: { Authorization: `Token ${token}` }
//         });

//         const existing = existingRes.data.find(item =>
//             item.implementing_unit === first.implementing_unit &&
//             item.project_goal_measure === first.project_goal_measure
//         );

//         const payload = {
//             implementing_unit: first.implementing_unit,
//             project_goal_measure: first.project_goal_measure,
//             start_date: first.start_date,
//             end_date: first.end_date,

//             implementing_unit_name: "ACC (Federal)",
//             approval_requested_by_name: "Mintamir Lakew",
//             approval_decision_by_name: "Amdeberhan Gizaw",

//             period_distributions: period_distributions.map(p => ({
//                 name: `EFY ${Number(p.start_date.slice(0,4)) - 7}`,
//                 actual: p.actual,
//                 target: p.target,
//                 start_date: p.start_date,
//                 end_date: p.end_date,
//                 period_frequency: "annually"
//             }))
//         };

//         let response;

//         if (existing) {
//             console.log("🔁 Updating existing record:", existing.id);

//             response = await axios.put(
//                 `${baseUrl}${existing.id}/`,
//                 payload,
//                 {
//                     headers: { Authorization: `Token ${token}` }
//                 }
//             );
//         } else {
//             console.log("🆕 Creating new record");

//             response = await axios.post(
//                 baseUrl,
//                 payload,
//                 {
//                     headers: { Authorization: `Token ${token}` }
//                 }
//             );
//         }

//         return res.json({
//             message: "✅ Synced successfully",
//             data: response.data
//         });

//     } catch (err) {
//         console.error("❌ Push error:", err.response?.data || err.message);

//         return res.status(500).json({
//             error: err.response?.data || err.message
//         });
//     }
// });
app.post('/api/pushData', async (req, res) => {
    try {
        const rawData = req.body;

        const period_distributions = transformToPayload(rawData);

        if (!Array.isArray(period_distributions) || !period_distributions.length) {
            return res.status(400).json({ error: "No valid data" });
        }

        const token = await getToken();
        const baseUrl = 'https://imp.ati.gov.et:8080/api/program-goal-measure-unit-distributions/';

        const first = period_distributions[0];

        const implementing_unit = Number(first.implementing_unit);
        const project_goal_measure = Number(first.project_goal_measure);

        if (!implementing_unit || !project_goal_measure) {
            return res.status(400).json({
                error: "Invalid mapping (IDs missing)"
            });
        }

        // 🔍 check existing
        const existingRes = await axios.get(baseUrl, {
            headers: { Authorization: `Token ${token}` }
        });

        const existing = existingRes.data.find(item =>
            Number(item.implementing_unit) === implementing_unit &&
            Number(item.project_goal_measure) === project_goal_measure
        );

        const payload = {
            implementing_unit,
            project_goal_measure,

            implementing_unit_name: "ACC (Federal)",
            approval_requested_by_name: "Mintamir Lakew",
            approval_decision_by_name: "Amdeberhan Gizaw",

            period_distributions: period_distributions.map(p => ({
                name: `EFY ${Number(p.start_date.slice(0,4)) - 7}`,
                start_date: p.start_date,
                end_date: p.end_date,
                actual: Number(p.actual),
                target: Number(p.target),
                period_frequency: "annually"
            }))
        };

        let recordId;

        // 1️⃣ CREATE OR UPDATE
        if (existing) {
            const updated = await axios.put(
                `${baseUrl}${existing.id}/`,
                payload,
                { headers: { Authorization: `Token ${token}` } }
            );

            recordId = existing.id;
        } else {
            const created = await axios.post(
                baseUrl,
                payload,
                { headers: { Authorization: `Token ${token}` } }
            );

            recordId = created.data.id;
        }

        // 2️⃣ SEND FOR APPROVAL (IMPORTANT STEP)
        const approvalResponse = await axios.post(
            `${baseUrl}${recordId}/approval-request/`,
            {
                comments: "Auto-submitted from integration system"
            },
            {
                headers: {
                    Authorization: `Token ${token}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        return res.json({
            message: "✅ Data submitted for approval successfully",
            recordId,
            approval: approvalResponse.data
        });

    } catch (err) {
        console.error("❌ Error:", err.response?.data || err.message);

        return res.status(500).json({
            error: err.response?.data || err.message
        });
    }
});
const PORT = 3000;

app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});