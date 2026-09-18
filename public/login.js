const loginBtn = document.getElementById("loginBtn");
const errorBox = document.getElementById("errorBox");

function showError(message) {
  errorBox.textContent = message;
  errorBox.style.display = "block";
}

loginBtn.addEventListener("click", async () => {
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  errorBox.style.display = "none";

  if (!email || !password) {
    showError("Please enter both email and password.");
    return;
  }

  loginBtn.disabled = true;
  loginBtn.textContent = "Please wait...";

  try {
    const res = await fetch(`${API_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    const data = await res.json();

    if (!res.ok) {
      showError(data.error || "Login failed. Check your email and password.");
      return;
    }

    if (data.role !== "manager") {
      showError("This login is for restaurant managers only.");
      return;
    }

    localStorage.setItem("managerToken", data.token);
    localStorage.setItem("managerRestaurantId", data.restaurantId);
    localStorage.setItem("managerName", data.name || "");

    window.location.href = "dashboard.html";
  } catch (err) {
    console.error(err);
    showError("Could not reach the server. Is your backend (node server.js) running?");
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = "Log In";
  }
});