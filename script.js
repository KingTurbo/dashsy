/* Helper functions for persistence */
function uint8ArrayToBase64(u8Arr) {
  let CHUNK_SIZE = 0x8000;
  let index = 0;
  let length = u8Arr.length;
  let result = '';
  let slice;
  while (index < length) {
    slice = u8Arr.subarray(index, Math.min(index + CHUNK_SIZE, length));
    result += String.fromCharCode.apply(null, slice);
    index += CHUNK_SIZE;
  }
  return btoa(result);
}

function base64ToUint8Array(base64) {
  let binary_string = atob(base64);
  let len = binary_string.length;
  let bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary_string.charCodeAt(i);
  }
  return bytes;
}

/* Format ISO date string into human-readable format: YYYY-MM-DD HH:mm */
function formatDate(dateStr) {
  const date = new Date(dateStr);
  if (isNaN(date)) return dateStr;
  const year = date.getFullYear();
  const month = ("0" + (date.getMonth() + 1)).slice(-2);
  const day = ("0" + date.getDate()).slice(-2);
  const hour = ("0" + date.getHours()).slice(-2);
  const minute = ("0" + date.getMinutes()).slice(-2);
  return `${year}-${month}-${day} ${hour}:${minute}`;
}

// Global variables
let globalDB = null;
let currentTableName = null;
let currentGroupCode = null;
let filterUnfinishedActive = false;
let showingSingleRandomTask = false; // Flag for single task display mode

async function initDatabase() {
  try {
    const SQL = await initSqlJs({
      locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/${file}`
    });
    const savedDB = localStorage.getItem('data_bifie_db');
    if (savedDB) {
      globalDB = new SQL.Database(base64ToUint8Array(savedDB));
    } else {
    const response = await fetch('data/data_bifie.db?cache=' + new Date().getTime());
    const clonedResponse = response.clone();
    const text = await clonedResponse.text();
    if (/^[A-Za-z0-9+/]+={0,2}$/.test(text.trim()) && text.trim().length % 4 === 0) {
      globalDB = new SQL.Database(base64ToUint8Array(text.trim()));
    } else {
      const uInt8Buffer = new Uint8Array(await response.arrayBuffer());
      globalDB = new SQL.Database(uInt8Buffer);
    }
      persistDatabase();
    }
    const tablesResult = globalDB.exec("SELECT name FROM sqlite_master WHERE type='table'");
    if (!tablesResult.length || !tablesResult[0].values.length) throw new Error('No tables found');
    currentTableName = tablesResult[0].values[0][0];
    console.log("Current table:", currentTableName);
    loadData(); // Initial data load
  } catch (error) {
    handleError('Error initializing database:', error);
  }
}

// Load and display data in the table
function loadData(searchTerm = "") {
  // If not forced by random pick, reset single task view
  if (!showingSingleRandomTask) {
        document.getElementById("randomTaskOutput").innerHTML = ""; // Clear random task display area
  }
  // Resetting flag if user initiates a normal load/search
  showingSingleRandomTask = false;


  try {
    if (!globalDB || !currentTableName) return; // DB not ready

    let query = `SELECT * FROM "${currentTableName}"`;
    const stmt = globalDB.exec(query);
    console.log("Query executed. stmt.length: " + stmt.length);
    const tableBody = document.getElementById('dashboard-body');
    const header = document.getElementById("dashboard-header");
    tableBody.innerHTML = ''; // Clear previous results
    header.innerHTML = ''; // Clear previous header

    if (!stmt.length || !stmt[0].values.length) {
      document.getElementById('error').textContent = 'No data found in the table.';
      return;
    }

    const columns = stmt[0].columns;
    const rows = stmt[0].values;
    console.log("Number of rows fetched: " + rows.length);

    // Filter rows
    const filteredRows = rows.filter(row => {
      const rowString = row.join(" ").toLowerCase();
      const matchesSearch = searchTerm === "" || rowString.includes(searchTerm.toLowerCase());
      let unfinishedOnly = true;
      if (filterUnfinishedActive) {
        const finishedIndex = columns.indexOf("finished");
        unfinishedOnly = !(row[finishedIndex] && row[finishedIndex].toString().trim() !== "");
      }
      return matchesSearch && unfinishedOnly;
    });

    // Generate table header
    let headerRow = document.createElement("tr");
    columns.forEach(col => {
      let th = document.createElement("th");
      th.textContent = col;
      headerRow.appendChild(th);
    });
    header.appendChild(headerRow);

    // Populate table body
    filteredRows.forEach((rowData) => {
      const tr = createTableRow(rowData, columns);
      tableBody.appendChild(tr);
    });

  } catch (error) {
    handleError('Error loading data:', error);
  }
}

// Helper to create a table row TR element
function createTableRow(rowData, columns) {
    const tr = document.createElement('tr');
    const finishedIndex = columns.indexOf("finished");
    const codeFullIndex = columns.indexOf("code_full");
    const codeFullValue = rowData[codeFullIndex];
    let finishedValue = rowData[finishedIndex];

    // Copy rowData to avoid modifying the original array during formatting
    let displayRowData = [...rowData];

    if (finishedValue && finishedValue.toString().trim() !== "") {
      let finishedStr = finishedValue.toString().trim();
      if (finishedStr.indexOf(',') !== -1) {
        // If multiple timestamps exist, use the last one for display
        const parts = finishedStr.split(',').map(s => s.trim());
        finishedStr = parts[parts.length - 1];
      }
      displayRowData[finishedIndex] = formatDate(finishedStr);
      tr.classList.add('done');
    } else {
      finishedValue = null; // Normalize for checks
    }

    tr.addEventListener('click', () => {
      currentGroupCode = codeFullValue; // Set for potential actions
      console.log("Row clicked. codeFullValue:", codeFullValue, "finishedValue:", finishedValue);
      if (document.getElementById('doneModal')) {
            openDoneModal(codeFullValue);
      } else {
            console.error("doneModal element not found!");
      }
    });

    displayRowData.forEach((cell) => {
      const td = document.createElement('td');
      td.textContent = cell ?? ''; // Use nullish coalescing for cleaner empty cells
      tr.appendChild(td);
    });
    return tr;
}


function updateProgress() {
  try {
    if (typeof Chart === 'undefined') {
      console.error('Chart.js library is not loaded');
    }
    let query = 'SELECT * FROM "' + currentTableName + '"';
    const stmt = globalDB.exec(query);
    if (!stmt.length) return;
    const columns = stmt[0].columns;
    const rows = stmt[0].values;

    // Aggregate finished tasks per day (YYYY-MM-DD)
    const finishedPerDay = {};
    rows.forEach(row => {
      const finishedIndex = columns.indexOf("finished");
      if (row[finishedIndex] && row[finishedIndex].toString().trim() !== "") {
        const finishedDate = new Date(row[finishedIndex]);
        // Format as YYYY-MM-DD
        const year = finishedDate.getFullYear();
        const month = ("0" + (finishedDate.getMonth()+1)).slice(-2);
        const day = ("0" + finishedDate.getDate()).slice(-2);
        const dateKey = `${year}-${month}-${day}`;
        finishedPerDay[dateKey] = (finishedPerDay[key] || 0) + 1;
      }
    });

    // Compute total unique tasks and uniquely finished tasks based on "code_full"
    const uniqueTasks = new Set();
    const finishedTasks = new Set();
    rows.forEach(row => {
      const codeIndex = columns.indexOf("code_full");
      const finishedIndex = columns.indexOf("finished");
      if (row[codeIndex]) {
        uniqueTasks.add(row[codeIndex]);
        if (row[finishedIndex] && row[finishedIndex].toString().trim() !== "") {
          finishedTasks.add(row[codeIndex]);
        }
      }
    });
    const totalTasks = uniqueTasks.size;
    let unfinishedTasksCount = totalTasks - finishedTasks.size;
    document.getElementById("unfinishedCount").textContent = "Unfinished tasks: " + unfinishedTasksCount + " / " + totalTasks;

    // Prepare data for chart: sort dates ascending, with fallback if no finished tasks are found
    let labels = Object.keys(finishedPerDay).sort();
    let data = labels.map(label => finishedPerDay[label]);
    if (labels.length === 0) {
      labels = ["No Tasks Achieved"];
      data = [0];
    }

    // Draw chart using Chart.js (Line Chart) showing tasks achieved per day
    const ctx = document.getElementById("progressChart").getContext("2d");
    if(window.myChart) {
      window.myChart.destroy();
    }
    window.myChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: 'Tasks Achieved',
          data: data,
          borderColor: '#4CAF50',
          backgroundColor: '#4CAF50', // Changed for better visibility if needed, or keep as borderColor
          fill: false,
          tension: 0.1
        }]
      },
      options: {
        responsive: true,
        plugins: {
          title: {
            display: true,
            text: 'Tasks Achieved Per Day'
          }
        },
        scales: {
          x: {
            title: {
              display: true,
              text: 'Date'
            }
          },
          y: {
            title: {
              display: true,
              text: 'Number of Tasks'
            },
            beginAtZero: true,
             ticks: { // Ensure y-axis shows only whole numbers
                stepSize: 1,
                precision: 0
            }
          }
        }
      }
    });
  } catch (error) {
    console.error("Error updating progress analysis:", error);
  }
}

// Modal interactions
function openDoneModal(codeFull) {
  currentGroupCode = codeFull;
  document.getElementById('codeFullText').textContent = codeFull;
    console.log("Opening doneModal. codeFull:", codeFull);
  document.getElementById('doneModal').style.display = 'block';
}
function closeDoneModal() {
  const modal = document.getElementById('doneModal');
  if (modal) {
    modal.style.display = 'none';
  }
}
function closeRatingModal() {
  const modal = document.getElementById('ratingModal');
  if (modal) {
    modal.style.display = 'none';
  }
}

function markTaskAsDone(codeFull) {
  try {
    if (!globalDB || !currentTableName) return;
    const now = new Date().toISOString();
    // Retrieve existingFinished value
    const result = globalDB.exec(`SELECT finished FROM "${currentTableName}" WHERE "code_full" = '${codeFull}' LIMIT 1`);
    let existingFinished = "";
    if (result.length && result[0].values.length) {
      existingFinished = result[0].values[0][0] || "";
    }
    let newFinished;
    if (existingFinished.trim() === "") {
      newFinished = now;
    } else {
      newFinished = `${existingFinished}, ${now}`;
    }
    // Update the finished field with the appended timestamp
    globalDB.run(`UPDATE "${currentTableName}" SET finished = '${newFinished}' WHERE "code_full" = '${codeFull}'`);
    persistDatabase();
    closeDoneModal();
    if (showingSingleRandomTask) {
         loadData();
    } else {
         loadData(document.getElementById('search').value);
    }
  } catch (error) {
    handleError('Error marking task as done:', error);
  }
}

// Submit rating
function submitRating(ratingValue) {
  try {
    // Check if ratingSelect element exists
    const ratingSelect = document.getElementById('ratingSelect');
    if (!ratingSelect) {
      console.warn("ratingSelect element not found, skipping rating submission");
      return;
    }
    if (!globalDB || !currentTableName || !currentGroupCode) return;
    // Use string interpolation to fetch existing rating since SQL.js exec(`SELECT Rating FROM "${currentTableName}" WHERE "code_full" = '${currentGroupCode}' LIMIT 1`);
    let existingRating = "";
    if (result.length && result[0].values.length) {
      existingRating = result[0].values[0][0] || "";
    }
    let newRating;
    if(existingRating.trim() === "") {
      newRating = ratingValue;
    } else {
      const ratings = existingRating.split(',').map(r => r.trim());
      if (!ratings.includes(ratingValue)) {
        newRating = `${existingRating}, ${ratingValue}`;
      } else {
        newRating = existingRating;
      }
    }
    // Update the Rating column using string interpolation
    globalDB.run(`UPDATE "${currentTableName}" SET Rating = '${newRating}' WHERE "code_full" = '${currentGroupCode}'`);
    persistDatabase();
    // Log the updated rating value for debugging
    const check = globalDB.exec(`SELECT Rating FROM "${currentTableName}" WHERE "code_full" = '${currentGroupCode}'`);
    console.log("Updated rating for", currentGroupCode, ":", check);
    if (document.getElementById('ratingModal')) {
      closeRatingModal();
    } else {
      console.warn("ratingModal element not found, skipping closeRatingModal");
    }
    // Refresh view - if singleTask, refresh its display, else refresh table
    if (showingSingleRandomTask) {
      displaySingleTask(currentGroupCode, true);
    } else {
      loadData(document.getElementById('search').value);
    }
  } catch (error) {
    handleError('Error submitting rating:', error);
  }
}

// View switching
function showDashboard() {
  document.getElementById('dashboardView').style.display = 'block';
  document.getElementById('progressView').style.display = 'none';
  // Ensure data is loaded correctly when switching back, unless showing single task
   if (!showingSingleRandomTask) {
        loadData(document.getElementById('search').value);
   }
}
function showProgress() {
  document.getElementById('dashboardView').style.display = 'none';
  document.getElementById('progressView').style.display = 'block';
  updateProgress();
}

let dbFileHandle = null;

async function setDbFile() {
  try {
    // Ask user to select the file location for the DB file.
    dbFileHandle = await window.showSaveFilePicker({
      suggestedName: "data_bifie.db",
      types: [{
        description: "SQLite DB",
        accept: { "application/x-sqlite3": [".db"] }
      }]
    });
    console.log("DB file handle set.");
  } catch (err) {
    console.error("Error setting DB file handle:", err);
  }
}

async function persistDatabase() {
  if (!globalDB) return;
  const exported = globalDB.export();
  const base64Str = uint8ArrayToBase64(exported);
  localStorage.setItem('data_bifie_db', base64Str);
  if (dbFileHandle) {
    try {
      const writable = await dbFileHandle.createWritable();
      await writable.write(base64Str);
      await writable.close();
      console.log("Database auto-updated on local file.");
    } catch (err) {
      console.error("Error auto-updating local file:", err);
    }
  } else {
    console.log("DB file handle not set; local file not auto-updated.");
  }
}

// Function to trigger database download
function downloadDatabase() {
  if (!globalDB) {
    alert("Database not loaded.");
    return;
  }
  try {
    const exportedData = globalDB.export(); // Uint8Array
    const blob = new Blob([exportedData], { type: 'application/vnd.sqlite3' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'data_bifie_updated.db'; // Suggest a new name to avoid accidental overwrite
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    console.log("Database download initiated.");
  } catch (error) {
    handleError("Error downloading database:", error);
  }
}

module.exports = { persistDatabase };

</final_file_content>

IMPORTANT: For any future changes to this file, use the final_file_content shown above as your reference. This content reflects the current state of the file, including any auto-formatting (e.g., if you used single quotes but the formatter converted them to double quotes). Always base your SEARCH/REPLACE operations on this final version to ensure accuracy.
