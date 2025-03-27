// Import Firestore functions (assuming v9 modular SDK loaded in HTML)
// Access the initialized db instance from the window object
const db = window.firebaseDB;
import {
  collection,
  query,
  where,
  getDocs,
  onSnapshot,
  doc,
  updateDoc,
  addDoc,
  deleteDoc,
  Timestamp, // Import Timestamp for date fields
  writeBatch // Import writeBatch for bulk operations like clear-db
} from "https://www.gstatic.com/firebasejs/9.6.10/firebase-firestore.js";

// --- Global Variables ---
const collectionName = "dashboard_items"; // Your Firestore collection name
const itemsCollectionRef = collection(db, collectionName);
let dashboardItems = []; // Local cache of items from Firestore
let currentItemId = null; // Store the Firestore ID of the item being interacted with
let filterUnfinishedActive = false;
let showingSingleRandomTask = false; // Flag for single task display mode
let currentSearchTerm = ""; // Store current search term
let unsubscribeSnapshot = null; // To detach the listener later if needed

// --- Helper Functions ---

/* Format Firestore Timestamp or ISO date string into human-readable format: YYYY-MM-DD HH:mm */
function formatDate(dateInput) {
  let date;
  if (dateInput instanceof Timestamp) {
    date = dateInput.toDate(); // Convert Firestore Timestamp to JS Date
  } else if (typeof dateInput === 'string') {
    date = new Date(dateInput);
  } else if (dateInput instanceof Date) {
    date = dateInput;
  } else {
    return dateInput; // Return original if not a recognizable date format
  }

  if (isNaN(date)) return dateInput; // Return original if parsing failed

  const year = date.getFullYear();
  const month = ("0" + (date.getMonth() + 1)).slice(-2);
  const day = ("0" + date.getDate()).slice(-2);
  const hour = ("0" + date.getHours()).slice(-2);
  const minute = ("0" + date.getMinutes()).slice(-2);
  return `${year}-${month}-${day} ${hour}:${minute}`;
}

// Generic error handler
function handleError(context, error) {
  console.error(context, error);
  const errorDiv = document.getElementById('error');
  if (errorDiv) {
    // Display a user-friendly message, log the full error to console
    errorDiv.textContent = `Error: ${context}. See console for details.`;
  }
}

// --- Firestore Interaction Functions ---

// Listen for real-time updates and load initial data
function listenForDataUpdates() {
  if (unsubscribeSnapshot) {
    unsubscribeSnapshot(); // Detach previous listener if exists
  }
  console.log("Setting up Firestore listener...");
  const q = query(itemsCollectionRef); // Simple query for all documents

  unsubscribeSnapshot = onSnapshot(q, (querySnapshot) => {
    console.log("Received Firestore snapshot update.");
    const newItems = []; // Build new list before replacing
    querySnapshot.forEach((doc) => {
      newItems.push({ id: doc.id, ...doc.data() });
    });
    dashboardItems = newItems; // Update local cache
    console.log("Total items fetched:", dashboardItems.length);
    // Render the table with the updated data, applying current filters/search
    renderTable();
    // Update progress chart if progress view is active
    if (document.getElementById('progressView').style.display !== 'none') {
      updateProgress();
    }
  }, (error) => {
    handleError("Error listening to Firestore:", error);
  });
}

// Update a task (mark as done, change rating, etc.)
async function updateTask(itemId, dataToUpdate) {
  if (!itemId) {
    handleError("Update failed: No item ID provided.");
    return;
  }
  console.log(`Updating item ${itemId} with:`, dataToUpdate);
  const itemDocRef = doc(db, collectionName, itemId);
  try {
    await updateDoc(itemDocRef, dataToUpdate);
    console.log("Item updated successfully in Firestore.");
    // UI will update automatically via onSnapshot listener
    // Close modals if the update originated from one
    closeDoneModal();
    closeRatingModal(); // Close rating modal if it was used
  } catch (error) {
    handleError(`Error updating item ${itemId}:`, error);
  }
}

// Add a new task (Example function)
async function addTask(newItemData) {
  console.log("Adding new item:", newItemData);
  // Add default fields if necessary, e.g., finished: null, Rating: null
  const dataToAdd = {
      finished: null,
      Rating: null,
      ...newItemData // User provided data overrides defaults
  };
  try {
    const docRef = await addDoc(itemsCollectionRef, dataToAdd);
    console.log("New item added with ID:", docRef.id);
    // UI will update automatically via onSnapshot listener
  } catch (error) {
    handleError("Error adding new item:", error);
  }
}

// Delete a task (Example function)
async function deleteTask(itemId) {
  if (!itemId) {
    handleError("Update failed: No item ID provided.");
    return;
  }
  // Find item details for confirmation message
  const itemToDelete = dashboardItems.find(item => item.id === itemId);
  const confirmMsg = itemToDelete
    ? `Are you sure you want to delete task: ${itemToDelete.name || itemToDelete.code_full || itemId}?`
    : `Are you sure you want to delete item ${itemId}?`;

  if (!confirm(confirmMsg)) {
    return;
  }
  console.log(`Deleting item ${itemId}`);
  const itemDocRef = doc(db, collectionName, itemId);
  try {
    await deleteDoc(itemDocRef);
    console.log("Item deleted successfully.");
    // UI will update automatically via onSnapshot listener
  } catch (error) {
    handleError(`Error deleting item ${itemId}:`, error);
  }
}

// --- UI Rendering and Interaction ---

// Render the table based on the local dashboardItems cache, search term, and filters
function renderTable() {
  // If showing single task, let displaySingleTask handle rendering
  if (showingSingleRandomTask) return;

  const tableBody = document.getElementById('dashboard-body');
  const header = document.getElementById("dashboard-header");
  tableBody.innerHTML = ''; // Clear previous results
  header.innerHTML = ''; // Clear previous header
  document.getElementById("randomTaskOutput").innerHTML = ""; // Clear random task display

  if (!dashboardItems.length) {
    tableBody.innerHTML = '<tr><td colspan="100%">No data found in Firestore collection.</td></tr>';
    return;
  }

  // Determine columns from the first item (assuming consistent structure)
  // Exclude the 'id' field we added from the header/display rows directly
  const columns = Object.keys(dashboardItems[0]).filter(key => key !== 'id');

  // Generate table header
  let headerRow = document.createElement("tr");
  columns.forEach(col => {
    let th = document.createElement("th");
    th.textContent = col;
    headerRow.appendChild(th);
  });
  header.appendChild(headerRow);

  // Filter items based on search term and unfinished filter
  const filteredItems = dashboardItems.filter(item => {
    // Search logic: check if search term exists in any field value (case-insensitive)
    const itemString = Object.values(item).join(" ").toLowerCase();
    const matchesSearch = currentSearchTerm === "" || itemString.includes(currentSearchTerm.toLowerCase());

    // Unfinished filter logic: check if 'finished' field is missing, null, or empty string
    let isUnfinished = true;
    if (item.hasOwnProperty('finished')) {
        const finishedValue = item.finished;
        // Consider null, undefined, empty string, or specific 'false' values as unfinished
        isUnfinished = !finishedValue || (typeof finishedValue === 'string' && finishedValue.trim() === '');
    }
    const matchesFilter = !filterUnfinishedActive || isUnfinished;

    return matchesSearch && matchesFilter;
  });

  // Populate table body with filtered items
  if (filteredItems.length === 0) {
      tableBody.innerHTML = '<tr><td colspan="100%">No data matches the current search/filter.</td></tr>';
  } else {
      filteredItems.forEach((item) => {
        const tr = createTableRow(item, columns);
        tableBody.appendChild(tr);
      });
  }
}

// Helper to create a table row TR element from a Firestore item object
function createTableRow(item, columns) {
    const tr = document.createElement('tr');
    const finishedValue = item.finished;
    const itemId = item.id; // Firestore document ID

    // Add 'done' class if the item is finished
    if (finishedValue && (typeof finishedValue !== 'string' || finishedValue.trim() !== '')) {
      tr.classList.add('done');
    }

    // Attach click listener to the row
    tr.addEventListener('click', () => {
      currentItemId = itemId; // Store Firestore ID for modal actions
      const codeFullValue = item.code_full || 'N/A'; // Get code_full for display
      console.log("Row clicked. Item ID:", itemId, "code_full:", codeFullValue);
      openDoneModal(codeFullValue, itemId); // Pass ID to modal opener
    });

    // Create cells based on the determined column order
    columns.forEach(colName => {
      const td = document.createElement('td');
      let cellValue = item[colName];

      // Format 'finished' date if it exists and is not empty
      if (colName === 'finished' && cellValue && (typeof cellValue !== 'string' || cellValue.trim() !== '')) {
        // Handle potential multiple timestamps (if migrated from old format)
        if (typeof cellValue === 'string' && cellValue.includes(',')) {
            const parts = cellValue.split(',').map(s => s.trim());
            cellValue = parts[parts.length - 1]; // Use the last one
        }
        td.textContent = formatDate(cellValue); // Format the date/timestamp
      } else {
        td.textContent = cellValue ?? ''; // Use nullish coalescing for cleaner empty cells
      }
      tr.appendChild(td);
    });
    return tr;
}

// Update progress chart based on local dashboardItems cache
function updateProgress() {
  try {
    if (typeof Chart === 'undefined') {
      console.error('Chart.js library is not loaded');
      return;
    }

    const finishedPerDay = {};
    let totalFinishedCount = 0;
    dashboardItems.forEach(item => {
      const finishedValue = item.finished;
      if (finishedValue && (typeof finishedValue !== 'string' || finishedValue.trim() !== '')) {
        totalFinishedCount++;
        let dateToFormat = finishedValue;
        // Handle potential multiple timestamps string
        if (typeof finishedValue === 'string' && finishedValue.includes(',')) {
            const parts = cellValue.split(',').map(s => s.trim());
            dateToFormat = parts[parts.length - 1];
        }
        // Format date key (handle Timestamp or Date string)
        let dateKey = '';
        try {
            let dateObj;
            if (dateToFormat instanceof Timestamp) dateObj = dateToFormat.toDate();
            else dateObj = new Date(dateToFormat);

            if (!isNaN(dateObj)) {
                const year = dateObj.getFullYear();
                const month = ("0" + (dateObj.getMonth() + 1)).slice(-2);
                const day = dateObj.getDate().toString().padStart(2, '0');
                dateKey = `${year}-${month}-${day}`;
                finishedPerDay[dateKey] = (finishedPerDay[dateKey] || 0) + 1;
            }
        } catch (e) { console.warn("Could not parse date for progress chart:", dateToFormat, e); }
      }
    });

    const totalTasks = dashboardItems.length; // Total items = total tasks
    const unfinishedTasksCount = totalTasks - totalFinishedCount;
    document.getElementById("unfinishedCount").textContent = `Unfinished tasks: ${unfinishedTasksCount} / ${totalTasks}`;

    // Prepare data for chart
    let labels = Object.keys(finishedPerDay).sort();
    let data = labels.map(label => finishedPerDay[label]);
    if (labels.length === 0) {
      labels = ["No Tasks Achieved"];
      data = [0];
    }

    // Draw chart
    const ctx = document.getElementById("progressChart").getContext("2d");
    if (window.myChart) {
      window.myChart.destroy(); // Destroy previous chart instance
    }
    window.myChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: 'Tasks Achieved',
          data: data,
          borderColor: '#4CAF50',
          backgroundColor: 'rgba(76, 175, 80, 0.2)', // Optional fill
          fill: true,
          tension: 0.1
        }]
      },
      options: {
        responsive: true,
        plugins: {
          title: { display: true, text: 'Tasks Achieved Per Day' },
          legend: { display: false }
        },
        scales: {
          x: { title: { display: true, text: 'Date' } },
          y: {
            title: { display: true, text: 'Number of Tasks' },
            beginAtZero: true,
            ticks: { stepSize: 1, precision: 0 }
          }
        }
      }
    });
  } catch (error) {
    handleError("Error updating progress analysis:", error);
  }
}

// --- Modal Interactions ---

function openDoneModal(codeFull, itemId) {
  currentItemId = itemId; // Store the Firestore ID
  document.getElementById('codeFullText').textContent = `Task: ${codeFull}`; // Display code_full
  // Pre-fill rating based on current item data
  const currentItem = dashboardItems.find(item => item.id === itemId);
  const ratingSelect = document.getElementById('ratingSelect');
  if (currentItem && currentItem.Rating && ratingSelect) {
      const ratingValue = typeof currentItem.Rating === 'string' ? currentItem.Rating.split(',').pop().trim() : currentItem.Rating;
      ratingSelect.value = ratingValue || 'false';
  } else if (ratingSelect) {
      ratingSelect.value = 'false'; // Default if no item or rating found
  }
  console.log("Opening doneModal for Item ID:", itemId);
  document.getElementById('doneModal').style.display = 'block';
}

function closeDoneModal() {
  const modal = document.getElementById('doneModal');
  if (modal) modal.style.display = 'none';
  currentItemId = null; // Clear stored ID when modal closes
}

// This modal seems redundant with doneModal, keeping logic separate for now
function closeRatingModal() {
  const modal = document.getElementById('ratingModal');
  if (modal) modal.style.display = 'none';
  // Avoid clearing currentItemId here if doneModal might still be open
}

// --- Action Handlers ---

function handleMarkTaskAsDone() {
  if (!currentItemId) {
    handleError("Cannot mark task done: No item selected.");
    return;
  }
  const now = Timestamp.now(); // Use Firestore Timestamp
  // Simple overwrite approach for 'finished' timestamp
  updateTask(currentItemId, { finished: now });
}

function handleSubmitRating(event) {
  event.preventDefault(); // Prevent form submission
  if (!currentItemId) {
    handleError("Cannot submit rating: No item selected.");
    return;
  }
  const ratingSelect = document.getElementById('ratingSelect');
  const ratingValue = ratingSelect.value;

  // Simple overwrite approach for 'Rating'
  updateTask(currentItemId, { Rating: ratingValue });
}

// Pick and display a random unfinished task
async function pickRandomTask() {
  showingSingleRandomTask = false; // Reset flag initially
  document.getElementById("randomTaskOutput").innerHTML = "Picking random task...";

  try {
    // Filter local cache for unfinished items
    const unfinishedItems = dashboardItems.filter(item => {
        let isUnfinished = true;
        if (item.hasOwnProperty('finished')) {
            const finishedValue = item.finished;
            isUnfinished = !finishedValue || (typeof finishedValue === 'string' && finishedValue.trim() === '');
        }
        return isUnfinished;
    });

    if (unfinishedItems.length === 0) {
      document.getElementById("randomTaskOutput").innerHTML = "<strong>All tasks are marked as done!</strong>";
      renderTable(); // Show the full (empty or all done) table
      return;
    }

    // Pick random item from the filtered list
    const randomItem = unfinishedItems[Math.floor(Math.random() * unfinishedItems.length)];
    console.log("Randomly selected item ID:", randomItem.id);

    // Display only this task
    displaySingleTask(randomItem.id, true); // true to update the output div

  } catch (error) {
    handleError("Error picking random task:", error);
    document.getElementById("randomTaskOutput").innerHTML = `<span style="color:red;">Error: ${error.message}</span>`;
    showingSingleRandomTask = false; // Ensure flag is reset on error
    renderTable(); // Show full table on error
  }
}

// Display details and table row(s) for a single item ID
function displaySingleTask(itemId, updateOutputDiv = false) {
    const tableBody = document.getElementById('dashboard-body');
    const header = document.getElementById("dashboard-header");
    const outputDiv = document.getElementById("randomTaskOutput");
    tableBody.innerHTML = ''; // Clear table body
    header.innerHTML = ''; // Clear table header
    if (updateOutputDiv) outputDiv.innerHTML = ''; // Clear output div

    const item = dashboardItems.find(i => i.id === itemId);

    if (!item) {
        handleError(`Error displaying single task: Item ID ${itemId} not found in local cache.`);
        tableBody.innerHTML = '<tr><td colspan="100%">Error loading task details.</td></tr>';
        if (updateOutputDiv) outputDiv.innerHTML = `<span style="color:red;">Error displaying task details.</span>`;
        showingSingleRandomTask = false; // Ensure flag is reset on error
        return;
    }

    // Determine columns (excluding 'id')
    const columns = Object.keys(item).filter(key => key !== 'id');

    // Generate header
    let headerRow = document.createElement("tr");
    columns.forEach(colName => {
        let th = document.createElement("th");
        th.textContent = col;
        headerRow.appendChild(th);
    });
    header.appendChild(headerRow);

    // Create and append the single table row
    const tr = createTableRow(item, columns);
    tableBody.appendChild(tr);

    // Update the randomTaskOutput div if requested
    if (updateOutputDiv) {
        let detailsHtml = `<strong>Random Task Selected:</strong><br><div class="task-details">`;
        columns.forEach(colName => {
            let cellValue = item[colName] ?? '';
            if (colName === 'finished' && cellValue && (typeof cellValue !== 'string' || cellValue.trim() !== '')) {
                cellValue = formatDate(cellValue);
            }
            if (cellValue.toString().trim() !== '') {
                detailsHtml += `<span><strong>${colName}:</strong> ${cellValue}</span><br>`;
            }
        });
        detailsHtml += `</div>`;
        outputDiv.innerHTML = detailsHtml;
    }
    // Ensure the flag is set correctly when displaying a single task
    showingSingleRandomTask = true;
}

// Clear 'finished' and 'Rating' fields for all documents
async function clearAllMarkings() {
    if (!confirm('Are you sure you want to clear the "finished" marking and "Rating" for ALL tasks? This cannot be undone!')) {
        return;
    }

    try {
        // Use a batched write to perform multiple updates efficiently
        const batch = writeBatch(db);

        dashboardItems.forEach(item => {
            const itemRef = doc(db, collectionName, item.id);
            batch.update(itemRef, { finished: null, Rating: null });
        });

        await batch.commit();
        console.log('Successfully cleared "finished" and "Rating" for all documents.');
        alert('Successfully cleared markings for all tasks.');
    } catch (error) {
        handleError('Error clearing all markings:', error);
        alert('Failed to clear markings. See console for details.');
    }
}

// --- View Switching ---

function showDashboard() {
  document.getElementById('dashboardView').style.display = 'block';
  document.getElementById('progressView').style.display = 'none';
  // If we were showing a single task, reset to show the full table
  if (showingSingleRandomTask) {
      showingSingleRandomTask = false;
      renderTable(); // Re-render the full table with current filters
  }
}

function showProgress() {
  document.getElementById('dashboardView').style.display = 'none';
  document.getElementById('progressView').style.display = 'block';
  updateProgress();
}

// --- Event Listeners Setup ---

document.addEventListener('DOMContentLoaded', () => {
  // View Buttons
  document.getElementById('dashboardBtn').addEventListener('click', showDashboard);
  document.getElementById('progressBtn').addEventListener('click', showProgress);

  // Action Buttons
  document.getElementById('randomTask').addEventListener('click', pickRandomTask);
  document.getElementById('filterUnfinished').addEventListener('click', () => {
    filterUnfinishedActive = !filterUnfinishedActive;
    document.getElementById('filterUnfinished').textContent = filterUnfinishedActive ? "Show All Tasks" : "Show Unfinished Only";
    renderTable(); // Re-render with current search, resets single view
  });

  // Search Input
  document.getElementById('search').addEventListener('input', (event) => {
    currentSearchTerm = event.target.value; // Store search term
    renderTable(); // Re-render with current search, resets single view
  });

  // Done Modal Buttons
  document.getElementById('markDoneButton').addEventListener('click', handleMarkTaskAsDone);

  // Rating Modal Buttons
  document.getElementById('ratingForm').addEventListener('submit', (event) => {
    event.preventDefault();
    handleSubmitRating(event);
  });
  document.getElementById('closeModal').addEventListener('click', closeDoneModal);

  // Clear DB Button
  document.getElementById('clear-db').addEventListener('click', clearAllMarkings);

  // Initial setup
  showDashboard(); // Show dashboard by default
  listenForDataUpdates(); // Start listening for Firestore updates
    document.addEventListener('keydown', (event) => {
    if (event.key === "Escape") {
      closeDoneModal();
      closeRatingModal();
    }
  });
});
