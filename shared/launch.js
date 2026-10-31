const form = document.querySelector("[data-launch]");

form?.addEventListener("submit", (event) => {
  event.preventDefault();
  const params = new URLSearchParams();

  for (const [key, value] of new FormData(form).entries()) {
    params.set(key, value === "on" ? "1" : String(value));
  }

  for (const box of form.querySelectorAll('input[type="checkbox"]')) {
    if (!box.checked) params.set(box.name, "0");
  }

  const action = form.getAttribute("action") || "play.html";
  window.location.href = `${action}?${params}`;
});
