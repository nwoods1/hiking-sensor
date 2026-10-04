(() => {
  const authDialog = document.getElementById("sign-in");
  const authToggle = document.querySelector("[data-auth-toggle]");
  const closeAuthButton = document.querySelector("[data-close-auth]");
  const hikesLink = document.querySelector("[data-hikes-link]");
  const form = document.getElementById("login-form");
  const sessionContent = document.getElementById("auth-session-content");
  const message = document.getElementById("auth-message");
  const formButtons = form?.querySelectorAll('button[type="submit"]') ?? [];

  let isSignedIn = false;

  function showMessage(text, isError = false) {
    if (!message) return;
    message.textContent = text;
    message.classList.toggle("notice-error", isError);
  }

  function renderHomeAuth(session) {
    isSignedIn = Boolean(session?.user && !session.user.is_anonymous);

    if (authToggle) {
      authToggle.textContent = isSignedIn ? "Sign out" : "Sign in";
      authToggle.setAttribute(
        "aria-label",
        isSignedIn ? "Sign out of Hiking Sensor" : "Sign in to Hiking Sensor",
      );
    }

    if (hikesLink) {
      hikesLink.href = isSignedIn ? "dashboard.html" : "#sign-in";
    }

    if (form) form.hidden = isSignedIn;
    if (sessionContent) sessionContent.hidden = !isSignedIn;
    if (isSignedIn && authDialog?.open) authDialog.close();
  }

  authToggle?.addEventListener("click", async () => {
    if (!isSignedIn) {
      if (authDialog && !authDialog.open) authDialog.showModal();
      return;
    }

    authToggle.disabled = true;
    try {
      const { error } = await sb.auth.signOut();
      if (error) throw error;
      showMessage("You have signed out.");
    } catch (error) {
      showMessage(`Could not sign out: ${error.message}`, true);
    } finally {
      authToggle.disabled = false;
    }
  });

  hikesLink?.addEventListener("click", (event) => {
    if (isSignedIn) return;
    event.preventDefault();
    if (authDialog && !authDialog.open) authDialog.showModal();
  });

  closeAuthButton?.addEventListener("click", () => authDialog?.close());

  authDialog?.addEventListener("click", (event) => {
    if (event.target === authDialog) authDialog.close();
  });

  if (window.location.hash === "#sign-in" && authDialog) {
    authDialog.showModal();
  }

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const action = event.submitter?.value;
    const email = form.elements.email.value.trim();
    const password = form.elements.password.value;

    showMessage(action === "signup" ? "Creating your account…" : "Signing in…");
    formButtons.forEach((button) => {
      button.disabled = true;
    });

    try {
      if (action === "signup") {
        const { data, error } = await sb.auth.signUp({ email, password });
        if (error) throw error;
        if (!data.session) {
          showMessage("Check your email to confirm your account.");
          return;
        }
      } else {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }

      window.location.href = "dashboard.html";
    } catch (error) {
      showMessage(error.message || "Authentication failed.", true);
    } finally {
      formButtons.forEach((button) => {
        button.disabled = false;
      });
    }
  });

  if (form || authToggle || hikesLink) {
    sb.auth.onAuthStateChange((_event, session) => renderHomeAuth(session));
  }
})();
