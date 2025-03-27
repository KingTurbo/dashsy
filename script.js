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

// Generic error handler (Moved definition BEFORE its first use)
function handleError(context, error) {
  console.error(context, error);
  const errorDiv = document.getElementById('error');
  if (errorDiv) {
    // Display a user-friendly message, log the full error to console
    let message = `Error: ${context}.`;
    // Add more specific Firebase error info if available
    if (error.code) {
      message += ` (Code: ${error.code}). Check Firestore Security Rules and Network.`;
    }
     message += ` See console for details.`;
    errorDiv.textContent = message;
    errorDiv.style.display = 'block'; // Make sure the error div is visible
  } else {
    // Fallback alert if the error div doesn't exist
    alert(`Error: ${context}. Code: ${error.code || 'N/A'}. Check console and Firestore Rules.`);
  }
}


/* Format Firestore Timestamp or ISO date string into human-readable format: YYYY-MM-DD HH:mm */
function formatDate(dateInput) {
  let date;
  if (dateInput instanceof Timestamp) {
    date = dateInput.toDate(); // Convert Firestore Timestamp to JS Date
  } else if (typeof dateInput === 'string') {
    // Attempt to parse common date string formats, including ISO
     try {
      date = new Date(dateInput);
    } catch (e) {
      console.warn("Could not parse date string:", dateInput, e);
      return dateInput; // Return original if parsing fails immediately
    }
  } else if (dateInput instanceof Date) {
    date = dateInput;
  } else {
    return dateInput; // Return original if not a recognizable date format
  }

  // Check if the date object is valid after potential parsing
  if (isNaN(date.getTime())) {
      console.warn("Invalid date object after parsing:", dateInput);
      return dateInput; // Return original if parsing resulted in an invalid date
  }

  const year = date.getFullYear();
  const month = ("0" + (date.getMonth() + 1)).slice(-2);
  const day = ("0" + date.getDate()).slice(-2);
  const hour = ("0" + date.getHours()).slice(-2);
  const minute = ("0" + date.getMinutes()).slice(-2);
  return `${year}-${month}-${day} ${hour}:${minute}`;
}


// --- Firestore Interaction Functions ---

// Listen for real-time updates and load initial data
function listenForDataUpdates() {
  if (unsubscribeSnapshot) {
    unsubscribeSnapshot(); // Detach previous listener if exists
  }
  console.log("Setting up Firestore listener...");
  const errorDiv = document.getElementById('error'); // Clear previous errors
  if (errorDiv) errorDiv.style.display = 'none';

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
     // Clear error message on successful update
     if (errorDiv) errorDiv.style.display = 'none';
  }, (error) => {
    // *** USE THE DEFINED handleError FUNCTION ***
    handleError("Error listening to Firestore:", error);
    // Attempt to render the table even on error, it might show "No data" or cached data
     renderTable();
  });
}


// Update a task (mark as done, change rating, etc.)
async function updateTask(itemId, dataToUpdate) {
  if (!itemId) {
    handleError("Update failed: No item ID provided.");
    return;
  }
  console.log(`Updating item ${itemId} with:`, dataToUpdate); // Log *before* trying
  const itemDocRef = doc(db, collectionName, itemId);
  try {
    await updateDoc(itemDocRef, dataToUpdate);
    console.log("Item updated successfully in Firestore:", itemId); // Log success specifically
    // UI will update automatically via onSnapshot listener
    // Close modals if the update originated from one
    closeDoneModal();
    closeRatingModal(); // Close rating modal if it was used
  } catch (error) {
    // *** ENHANCED LOGGING ***
    console.error(`Firestore update failed for item ${itemId}:`, error);
    console.error("Error Code:", error.code); // Log the specific Firebase error code
    console.error("Error Message:", error.message); // Log the Firebase error message
    handleError(`Error updating item ${itemId} (Code: ${error.code})`, error); // Pass more info to UI handler
  }
}


// Add a new task (Example function)
async function addTask(newItemData) {
  console.log("Adding new item:", newItemData);
  // Add default fields if necessary, e.g., finished: null, Rating: null
  // Ensure required fields expected by your app/rules are present
  const dataToAdd = {
      finished: null,
      Rating: null,
      // Add other fields expected by your data structure if not provided
      // For example: dateRelease: Timestamp.now() ?
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
    handleError("Delete failed: No item ID provided."); // Corrected error message context
    return;
  }
  // Find item details for confirmation message
  const itemToDelete = dashboardItems.find(item => item.id === itemId);
  const confirmMsg = itemToDelete
    ? `Are you sure you want to delete task: ${itemToDelete.name || itemToDelete.codeFull || itemId}?` // Adjusted property name
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

  if (!dashboardItems || dashboardItems.length === 0) { // Added check for undefined dashboardItems
    tableBody.innerHTML = '<tr><td colspan="100%">Loading data or no data found... Check Firestore connection and Rules.</td></tr>';
    return;
  }

  // Determine columns from the first item (assuming consistent structure)
  // Exclude the 'id' field we added from the header/display rows directly
  const columns = ["insertItem", "name", "dateRelease", "codeSection", "codeFull", "finished", "Rating"];

  // Generate table header
  let headerRow = document.createElement("tr");
  columns.forEach(col => {
    let th = document.createElement("th");
    th.textContent = col;
    headerRow.appendChild(th);
  });
  // Add an actions column header (optional, if you add delete buttons etc. to rows)
  // let thAction = document.createElement("th");
  // thAction.textContent = "Actions";
  // headerRow.appendChild(thAction);
  header.appendChild(headerRow);

  // Filter items based on search term and unfinished filter
  const filteredItems = dashboardItems.filter(item => {
    // Search logic: check if search term exists in any field value (case-insensitive)
    // Ensure values are converted to string before searching
    const itemString = Object.values(item).map(val => String(val ?? '')).join(" ").toLowerCase();
    const matchesSearch = currentSearchTerm === "" || itemString.includes(currentSearchTerm.toLowerCase());

    // Unfinished filter logic: check if 'finished' field is missing, null, or empty string
    let isUnfinished = true;
    if (item.hasOwnProperty('finished')) {
        const finishedValue = item.finished;
        // Consider null, undefined, empty string, or specific 'false' values as unfinished
        // Also check for empty Timestamp objects if that's possible
        isUnfinished = !finishedValue || (typeof finishedValue === 'string' && finishedValue.trim() === '');
         // If finishedValue could be an empty Timestamp, add a check: !(finishedValue instanceof Timestamp && finishedValue.seconds === 0)
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
    tr.addEventListener('click', (event) => {
       // Prevent triggering row click if a button inside the row was clicked (if you add buttons later)
       if (event.target.tagName === 'BUTTON') return;

      currentItemId = itemId; // Store Firestore ID for modal actions
      const codeFullValue = item.codeFull || 'N/A'; // Adjusted property name
      console.log("Row clicked. Item ID:", itemId, "code_full:", codeFullValue);
      openDoneModal(codeFullValue, itemId); // Pass ID to modal opener
    });

    // Create cells based on the determined column order
    columns.forEach(colName => {
      const td = document.createElement('td');
      let cellValue = item[colName];

      // Format 'finished' date if it exists and is not empty/null
      if (colName === 'finished' && cellValue && (typeof cellValue !== 'string' || cellValue.trim() !== '')) {
        // Handle potential multiple timestamps (if migrated from old format) - Be cautious with this logic
        if (typeof cellValue === 'string' && cellValue.includes(',')) {
            const parts = cellValue.split(',').map(s => s.trim());
            cellValue = parts[parts.length - 1]; // Use the last one - might be risky
             console.warn("Multiple timestamps found in 'finished' field, using the last one:", cellValue);
        }
        td.textContent = formatDate(cellValue); // Format the date/timestamp
      } else {
        td.textContent = cellValue ?? ''; // Use nullish coalescing for cleaner empty cells
      }
      tr.appendChild(td);
    });

     // Add action buttons (example: delete button)
    // const tdAction = document.createElement('td');
    // const deleteButton = document.createElement('button');
    // deleteButton.textContent = 'Delete';
    // deleteButton.onclick = (event) => {
    //     event.stopPropagation(); // Prevent row click listener
    //     deleteTask(itemId);
    // };
    // tdAction.appendChild(deleteButton);
    // tr.appendChild(tdAction);

    return tr;
}

// Update progress chart based on local dashboardItems cache
function updateProgress() {
  try {
    if (typeof Chart === 'undefined') {
      console.error('Chart.js library is not loaded');
      return;
    }
    if (!dashboardItems || dashboardItems.length === 0) { // Added check
        console.log("No items available to update progress chart.");
         // Optionally clear or display a "no data" message on the chart
        return;
    }

    const finishedPerDay = {};
    let totalFinishedCount = 0;
    dashboardItems.forEach(item => {
      const finishedValue = item.finished;
      if (finishedValue && (typeof finishedValue !== 'string' || finishedValue.trim() !== '')) {
        totalFinishedCount++;
        let dateToFormat = finishedValue;
        // Handle potential multiple timestamps string - Use with caution
        if (typeof finishedValue === 'string' && finishedValue.includes(',')) {
            const parts = finishedValue.split(',').map(s => s.trim()); // Changed 'cellValue' to 'finishedValue'
            dateToFormat = parts[parts.length - 1];
        }
        // Format date key (handle Timestamp or Date string)
        let dateKey = '';
        try {
            let dateObj;
            if (dateToFormat instanceof Timestamp) dateObj = dateToFormat.toDate();
            else dateObj = new Date(dateToFormat);

            if (!isNaN(dateObj.getTime())) { // Check validity
                const year = dateObj.getFullYear();
                const month = ("0" + (dateObj.getMonth() + 1)).slice(-2);
                const day = dateObj.getDate().toString().padStart(2, '0');
                dateKey = `${year}-${month}-${day}`;
                finishedPerDay[dateKey] = (finishedPerDay[dateKey] || 0) + 1;
            } else {
                console.warn("Could not parse date for progress chart:", dateToFormat);
            }
        } catch (e) { console.warn("Error parsing date for progress chart:", dateToFormat, e); }
      }
    });

    const totalTasks = dashboardItems.length; // Total items = total tasks
    const unfinishedTasksCount = totalTasks - totalFinishedCount;
    document.getElementById("unfinishedCount").textContent = `Unfinished tasks: ${unfinishedTasksCount} / ${totalTasks}`;

    // Prepare data for chart
    let labels = Object.keys(finishedPerDay).sort();
    let cumulativeData = [];
    let cumulativeCount = 0;
    labels.forEach(label => {
      cumulativeCount += finishedPerDay[label];
      cumulativeData.push(cumulativeCount);
    });

    if (labels.length === 0) {
      labels = ["No Tasks Achieved Yet"]; // More descriptive label
      cumulativeData = [0];
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
          label: 'Tasks Achieved (Cumulative)',
          data: cumulativeData,
          borderColor: '#4CAF50',
          backgroundColor: 'rgba(76, 175, 80, 0.2)', // Optional fill
          fill: true,
          tension: 0.1
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false, // Allow chart to resize height/width independently
        plugins: {
          title: { display: true, text: 'Cumulative Tasks Achieved Over Time' },
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

    // Gamification elements
    const pointsPerTask = 10;
    const currentPoints = totalFinishedCount * pointsPerTask;
    const levelThresholds = [0, 50, 100, 200, 500]; // Example level thresholds
    let currentLevel = 0;
    while (currentLevel < levelThresholds.length - 1 && currentPoints >= levelThresholds[currentLevel + 1]) {
      currentLevel++;
    }
    const pointsToNextLevel = currentLevel < levelThresholds.length - 1 ? levelThresholds[currentLevel + 1] - currentPoints : 0;

    let progressHtml = `
      <div class="gamification">
        <h4>Your Progress</h4>
        <p>Points: ${currentPoints}</p>
        <p>Level: ${currentLevel + 1} (Tasks: ${totalFinishedCount})</p>
        ${currentLevel < levelThresholds.length - 1 ? `<p>Tasks to next level: ${pointsToNextLevel / pointsPerTask}</p>` : `<p>You have reached the maximum level!</p>`}
      </div>
    `;
    document.getElementById("progressAnalysis").innerHTML = progressHtml;

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
      // Handle potential multiple ratings string - Use last one
      const ratingValue = typeof currentItem.Rating === 'string' ? currentItem.Rating.split(',').pop().trim() : currentItem.Rating;
      // Ensure the value exists in the dropdown options
      if ([...ratingSelect.options].map(o => o.value).includes(String(ratingValue))) {
         ratingSelect.value = String(ratingValue);
      } else {
         console.warn(`Rating value '${ratingValue}' not found in dropdown options.`);
         ratingSelect.value = 'false'; // Default if rating value not found
      }
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


// --- Firestore Interaction Functions --- (Add this new function here)

/**
 * Finds all documents with a specific codeFull value and updates them using a batch write.
 * @param {string} codeFullValue The codeFull value to query for.
 * @param {object} dataToUpdate An object containing the fields and values to update.
 */


async function updateItemGroupByCodeFull(codeFullValue, dataToUpdate) {
  if (!codeFullValue) {
    handleError("Group update failed: No codeFull value provided.");
    return;
  }
  console.log(`Attempting group update for codeFull '${codeFullValue}' with data:`, dataToUpdate);

  // 1. Query for all documents with the matching codeFull
  const q = query(itemsCollectionRef, where("codeFull", "==", codeFullValue));

  try {
    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) {
      console.warn(`No documents found with codeFull '${codeFullValue}' to update.`);
      // Still close modals maybe? Or inform user? For now, just log.
      closeDoneModal(); // Close modal even if nothing was found matching codeFull
      closeRatingModal();
      return;
    }

    // 2. Create a batch write
    const batch = writeBatch(db);
    let updatedCount = 0;

    // 3. Add update operations to the batch for each matching document
    querySnapshot.forEach((doc) => {
      console.log(`Adding update for doc ${doc.id} to batch.`);
      batch.update(doc.ref, dataToUpdate);
      updatedCount++;
    });

    // 4. Commit the batch
    await batch.commit();
    console.log(`Successfully updated ${updatedCount} documents with codeFull '${codeFullValue}'.`);

    // UI updates will happen via the onSnapshot listener.
    // Close modals after successful batch commit.
    closeDoneModal();
    closeRatingModal();

  } catch (error) {
    console.error(`Firestore group update failed for codeFull '${codeFullValue}':`, error);
    console.error("Error Code:", error.code);
    console.error("Error Message:", error.message);
    handleError(`Error updating group for codeFull '${codeFullValue}' (Code: ${error.code})`, error);
  }
}

// ... (keep existing functions like listenForDataUpdates, updateTask, addTask, deleteTask)


// --- Action Handlers ---
// --- Action Handlers ---

async function handleMarkTaskAsDone() { // Make async if calling an async function
  if (!currentItemId) {
    handleError("Cannot mark task done: No item selected.");
    return;
  }

  // Find the clicked item in the local cache to get its codeFull value
  const currentItem = dashboardItems.find(item => item.id === currentItemId);

  if (!currentItem || !currentItem.codeFull) {
      handleError("Cannot mark task done: Could not find item or codeFull value.", { currentItemId });
      closeDoneModal(); // Close modal even on error finding item
      return;
  }

  const codeFullValue = currentItem.codeFull;
  const now = Timestamp.now(); // Use Firestore Timestamp

  console.log(`Marking group with codeFull '${codeFullValue}' as done.`);
  // Call the group update function instead of the single updateTask
  await updateItemGroupByCodeFull(codeFullValue, { finished: now });

  // Note: Modal closing is now handled inside updateItemGroupByCodeFull on success/error
  // We no longer call updateTask here.
}


async function handleSubmitRating(event) { // Make async
  event.preventDefault(); // Prevent form submission
  if (!currentItemId) {
    handleError("Cannot submit rating: No item selected.");
    return;
  }

  // Find the clicked item in the local cache to get its codeFull value
  const currentItem = dashboardItems.find(item => item.id === currentItemId);

  if (!currentItem || !currentItem.codeFull) {
      handleError("Cannot submit rating: Could not find item or codeFull value.", { currentItemId });
      closeDoneModal(); // Close modal even on error finding item
      return;
  }

  const codeFullValue = currentItem.codeFull;
  const ratingSelect = document.getElementById('ratingSelect');
  let ratingValue = ratingSelect.value; // This is currently a string ('easy', 'medium', etc.)

  console.log(`Preparing to update rating for group with codeFull '${codeFullValue}' with value:`, ratingValue);

  // Call the group update function instead of the single updateTask
  await updateItemGroupByCodeFull(codeFullValue, { Rating: ratingValue }); // Check if frontend expects 'rating' or 'Rating' field

  // Note: Modal closing is now handled inside updateItemGroupByCodeFull on success/error
  // We no longer call updateTask here.
}

// ... (keep other functions like pickRandomTask, displayTasks, etc.)



// Pick and display a random unfinished task
async function pickRandomTask() {
  showingSingleRandomTask = false; // Reset flag initially
  document.getElementById("randomTaskOutput").innerHTML = "Picking random task...";

  try {
      if (!dashboardItems || dashboardItems.length === 0) {
          document.getElementById("randomTaskOutput").innerHTML = "<strong>No tasks available to pick from!</strong>";
          renderTable();
          return;
      }
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

    // Pick random codeFull from the filtered list
    const codeFulls = [...new Set(unfinishedItems.map(item => item.codeFull))];
    const randomCodeFull = codeFulls[Math.floor(Math.random() * codeFulls.length)];
    console.log("Randomly selected codeFull:", randomCodeFull);

    // Find all items with the selected codeFull
    const itemsToDisplay = dashboardItems.filter(item => item.codeFull === randomCodeFull);

    // Display those tasks
    displayTasks(itemsToDisplay);

  } catch (error) {
    handleError("Error picking random task:", error);
    document.getElementById("randomTaskOutput").innerHTML = `<span style="color:red;">Error picking task. See console.</span>`;
    showingSingleRandomTask = false; // Ensure flag is reset on error
    renderTable(); // Show full table on error
  }
}

function displayTasks(tasks) {
  const tableBody = document.getElementById('dashboard-body');
  const header = document.getElementById("dashboard-header");
  const outputDiv = document.getElementById("randomTaskOutput");
  tableBody.innerHTML = ''; // Clear table body
  header.innerHTML = ''; // Clear table header
  outputDiv.innerHTML = ''; // Clear output div

  if (!tasks || tasks.length === 0) {
    tableBody.innerHTML = '<tr><td colspan="100%">No tasks to display.</td></tr>';
    return;
  }

  // Determine columns from the first item
  const columns = Object.keys(tasks[0]).filter(key => key !== 'id');

  // Generate header
  let headerRow = document.createElement("tr");
  columns.forEach(colName => {
    let th = document.createElement("th");
    th.textContent = colName;
    headerRow.appendChild(th);
  });
  header.appendChild(headerRow);

  // Create and append table rows
  tasks.forEach(task => {
    const tr = createTableRow(task, columns);
    tableBody.appendChild(tr);
  });

  showingSingleRandomTask = true;
}

// Display details and table row(s) for a single item ID
function displaySingleTask(itemId, updateOutputDiv = false) {
    const tableBody = document.getElementById('dashboard-body');
    const header = document.getElementById("dashboard-header");
    const outputDiv = document.getElementById("randomTaskOutput");
    tableBody.innerHTML = ''; // Clear table body
    header.innerHTML = ''; // Clear table header
    if (updateOutputDiv) outputDiv.innerHTML = ''; // Clear output div

    if (!dashboardItems) { // Added check
        handleError(`Error displaying single task: Dashboard items not loaded.`);
        if (updateOutputDiv) outputDiv.innerHTML = `<span style="color:red;">Error displaying task details (data not loaded).</span>`;
        showingSingleRandomTask = false;
        return;
    }

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
        th.textContent = colName; // Corrected variable name
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
            // Only display non-empty values for clarity
            if (String(cellValue).trim() !== '') {
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
  // ... (confirmation dialog) ...
  // ... (check if dashboardItems exists) ...

  try {
      // ... (batch initialization) ...

      for (const item of dashboardItems) {
          const itemRef = doc(db, collectionName, item.id);
          // *** Ensure field names match exactly what you use elsewhere ('rating' or 'Rating') ***
          batch.update(itemRef, { finished: null, Rating: null }); // Or rating: null
          // ... (batch commit logic) ...
      }

      // ... (final batch commit logic) ...
      // ... (success messages) ...
  } catch (error) {
      // ... (error handling) ...
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
  console.log("DOM fully loaded and parsed."); // Debug log

  // Check if db is initialized (add small delay if needed)
  if (!db) {
      console.error("Firebase DB not initialized when DOMContentLoaded fired!");
      handleError("Initialization Error", { message: "Firebase DB not ready."});
      // You might retry initialization or show a permanent error here
      return;
  } else {
       console.log("Firebase DB seems initialized.");
  }


  // View Buttons
  const dashboardBtn = document.getElementById('dashboardBtn');
  const progressBtn = document.getElementById('progressBtn');
  if (dashboardBtn) dashboardBtn.addEventListener('click', showDashboard);
  if (progressBtn) progressBtn.addEventListener('click', showProgress);

  // Action Buttons
  const randomTaskBtn = document.getElementById('randomTask');
  const filterUnfinishedBtn = document.getElementById('filterUnfinished');
  if (randomTaskBtn) randomTaskBtn.addEventListener('click', pickRandomTask);
  if (filterUnfinishedBtn) {
    filterUnfinishedBtn.addEventListener('click', () => {
      filterUnfinishedActive = !filterUnfinishedActive;
      filterUnfinishedBtn.textContent = filterUnfinishedActive ? "Show All Tasks" : "Show Unfinished Only";
      showingSingleRandomTask = false; // Filtering should show the table view
      renderTable(); // Re-render with current search/filter
    });
  }

  // Search Input
  const searchInput = document.getElementById('search');
  if (searchInput) {
    searchInput.addEventListener('input', (event) => {
      currentSearchTerm = event.target.value; // Store search term
      showingSingleRandomTask = false; // Searching should show the table view
      renderTable(); // Re-render with current search/filter
    });
  }

  // Done Modal Buttons
  const markDoneBtn = document.getElementById('markDoneButton');
  const closeModalBtn = document.getElementById('closeModal');
  if (markDoneBtn) markDoneBtn.addEventListener('click', handleMarkTaskAsDone);
  if (closeModalBtn) closeModalBtn.addEventListener('click', closeDoneModal);


  // Rating Modal Buttons (Assuming rating elements are inside the 'doneModal')
  const ratingForm = document.getElementById('ratingForm');
  if (ratingForm) {
    ratingForm.addEventListener('submit', (event) => {
      event.preventDefault();
      handleSubmitRating(event);
    });
  }


  // Clear DB Button
  const clearDbBtn = document.getElementById('clear-db');
  if (clearDbBtn) clearDbBtn.addEventListener('click', clearAllMarkings);

  // Initial setup
  showDashboard(); // Show dashboard by default
  listenForDataUpdates(); // Start listening for Firestore updates

  // Global listener for Escape key to close modals
  document.addEventListener('keydown', (event) => {
    if (event.key === "Escape") {
      closeDoneModal();
      closeRatingModal(); // Close this too if it's separate
    }
  });

   console.log("Event listeners attached."); // Debug log
});
