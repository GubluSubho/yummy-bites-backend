const token = localStorage.getItem("managerToken");
const restaurantId = localStorage.getItem("managerRestaurantId");

const statusBox = document.getElementById("statusBox");
const itemsList = document.getElementById("itemsList");
const restaurantTitle = document.getElementById("restaurantTitle");

if (!token || !restaurantId) {
  window.location.href = "login.html";
}

restaurantTitle.textContent = (RESTAURANT_NAMES[restaurantId] || "Manager") + "'s Menu";

document.getElementById("logoutBtn").addEventListener("click", () => {
  localStorage.removeItem("managerToken");
  localStorage.removeItem("managerRestaurantId");
  localStorage.removeItem("managerName");
  window.location.href = "login.html";
});

function showStatus(message, isError) {
  statusBox.textContent = message;
  statusBox.style.display = "block";
  statusBox.className = "status-box " + (isError ? "status-error" : "status-success");
  setTimeout(() => { statusBox.style.display = "none"; }, 2500);
}

async function loadMenu() {
  itemsList.innerHTML = "<p>Loading menu...</p>";
  try {
    const res = await fetch(`${API_URL}/menu/${restaurantId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const items = await res.json();

    if (!res.ok) {
      itemsList.innerHTML = `<p class="error-box">Could not load menu.</p>`;
      return;
    }

    renderItems(items);
  } catch (err) {
    console.error(err);
    itemsList.innerHTML = `<p class="error-box">Could not reach the server. Is node server.js running?</p>`;
  }
}

function renderItems(items) {
  itemsList.innerHTML = "";

  items.forEach((item) => {
    const row = document.createElement("div");
    row.className = "item-row";

    row.innerHTML = `
      <div class="item-info">
        <div class="item-name" data-id="${item._id}">${item.name}</div>
        <div class="item-type">${item.type || ""}</div>
        <div class="item-price" data-id="${item._id}">₹${item.price}</div>
      </div>
      <label class="switch">
        <input type="checkbox" ${item.isAvailable ? "checked" : ""} data-id="${item._id}" class="availability-toggle" />
        <span class="slider"></span>
      </label>
      <input type="number" class="qty-input" value="${item.quantity}" min="0" data-id="${item._id}" />
      <button class="edit-btn" data-id="${item._id}" data-name="${item.name}" data-price="${item.price}">Edit</button>
      <button class="delete-btn" data-id="${item._id}" data-name="${item.name}">Delete</button>
    `;

    itemsList.appendChild(row);
  });

  document.querySelectorAll(".availability-toggle").forEach((toggle) => {
    toggle.addEventListener("change", async (e) => {
      const itemId = e.target.dataset.id;
      const isAvailable = e.target.checked;
      try {
        const res = await fetch(`${API_URL}/menu/${itemId}/availability`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ isAvailable }),
        });
        if (!res.ok) throw new Error("Update failed");
        showStatus("Availability updated", false);
      } catch (err) {
        console.error(err);
        e.target.checked = !isAvailable;
        showStatus("Failed to update availability", true);
      }
    });
  });

  document.querySelectorAll(".qty-input").forEach((input) => {
    input.addEventListener("change", async (e) => {
      const itemId = e.target.dataset.id;
      const quantity = parseInt(e.target.value, 10) || 0;
      try {
        const res = await fetch(`${API_URL}/menu/${itemId}/quantity`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ quantity }),
        });
        if (!res.ok) throw new Error("Update failed");
        showStatus("Quantity updated", false);
      } catch (err) {
        console.error(err);
        showStatus("Failed to update quantity", true);
      }
    });
  });

  document.querySelectorAll(".edit-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const itemId = btn.dataset.id;
      const currentName = btn.dataset.name;
      const currentPrice = btn.dataset.price;

      const newName = prompt("Item name:", currentName);
      if (newName === null) return;

      const newPriceStr = prompt("Price (₹):", currentPrice);
      if (newPriceStr === null) return;
      const newPrice = parseFloat(newPriceStr);

      if (!newName.trim() || isNaN(newPrice) || newPrice <= 0) {
        showStatus("Invalid name or price", true);
        return;
      }

      try {
        const res = await fetch(`${API_URL}/menu/${itemId}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ name: newName.trim(), price: newPrice }),
        });
        if (!res.ok) throw new Error("Update failed");
        showStatus("Item updated", false);
        loadMenu();
      } catch (err) {
        console.error(err);
        showStatus("Failed to update item", true);
      }
    });
  });

  document.querySelectorAll(".delete-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const itemId = btn.dataset.id;
      const name = btn.dataset.name;

      const confirmed = confirm(`Delete "${name}"? This cannot be undone.`);
      if (!confirmed) return;

      try {
        const res = await fetch(`${API_URL}/menu/${itemId}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error("Delete failed");
        showStatus("Item deleted", false);
        loadMenu();
      } catch (err) {
        console.error(err);
        showStatus("Failed to delete item", true);
      }
    });
  });
}

document.getElementById("addItemBtn").addEventListener("click", async () => {
  const name = document.getElementById("newItemName").value.trim();
  const type = document.getElementById("newItemType").value.trim();
  const price = parseFloat(document.getElementById("newItemPrice").value);
  const quantity = parseInt(document.getElementById("newItemQuantity").value, 10) || 0;

  if (!name || !price || price <= 0) {
    showStatus("Please enter at least a name and a valid price", true);
    return;
  }

  const addBtn = document.getElementById("addItemBtn");
  addBtn.disabled = true;
  addBtn.textContent = "Adding...";

  try {
    const res = await fetch(`${API_URL}/menu/add`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        name,
        type: type || "Uncategorized",
        price,
        quantity,
        isAvailable: true,
        restaurantId,
      }),
    });

    if (!res.ok) throw new Error("Failed to add item");

    document.getElementById("newItemName").value = "";
    document.getElementById("newItemType").value = "";
    document.getElementById("newItemPrice").value = "";
    document.getElementById("newItemQuantity").value = "20";

    showStatus("Item added!", false);
    loadMenu();
  } catch (err) {
    console.error(err);
    showStatus("Failed to add item", true);
  } finally {
    addBtn.disabled = false;
    addBtn.textContent = "Add Item";
  }
});

loadMenu();