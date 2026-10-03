(() => {
    const config = window.HIKING_SENSOR_SUPABASE;
    const configured = Boolean(
        config
        && config.url.startsWith("https://")
        && config.anonKey
        && !config.anonKey.includes("YOUR_SUPABASE")
    );
    const loginForm = document.getElementById("login-form");
    const authMessage = document.getElementById("auth-message");
    const signOutButton = document.querySelector("[data-sign-out]");
    const accountMessage = document.getElementById("account-message");
    const showMessage = (message, isError = false) => {
        if (!authMessage) return;
        authMessage.textContent = message;
        authMessage.classList.toggle("notice-error", isError);
    };

    if (!configured) {
        if (loginForm) {
            loginForm.addEventListener("submit", (event) => {
                event.preventDefault();
                showMessage("Add your Supabase project URL and public anon key in supabase-config.js to enable account access.", true);
            });
        }
        if (accountMessage) {
            accountMessage.textContent = "Supabase is not configured yet. This page is available as a front-end preview.";
        }
        return;
    }

    if (!window.supabase?.createClient) {
        showMessage("The Supabase client could not be loaded. Check your network connection and try again.", true);
        return;
    }

    const client = window.supabase.createClient(config.url, config.anonKey);

    if (loginForm) {
        loginForm.addEventListener("submit", async (event) => {
            event.preventDefault();
            const submitter = event.submitter;
            const action = submitter?.value;
            const email = loginForm.elements.email.value.trim();
            const password = loginForm.elements.password.value;
            const button = submitter;
            if (button) button.disabled = true;
            showMessage(action === "signup" ? "Creating your account…" : "Signing in…");
            try {
                if (action === "signup") {
                    const { data, error } = await client.auth.signUp({ email, password });
                    if (error) throw error;
                    if (!data.session) {
                        showMessage("Check your email to confirm your account, then come back to sign in.");
                    } else {
                        window.location.href = "dashboard.html";
                    }
                } else {
                    const { error } = await client.auth.signInWithPassword({ email, password });
                    if (error) throw error;
                    window.location.href = "dashboard.html";
                }
            } catch (error) {
                showMessage(error.message || "Authentication failed.", true);
            } finally {
                if (button) button.disabled = false;
            }
        });
    }

    if (document.body.hasAttribute("data-require-auth")) {
        client.auth.getUser().then(({ data, error }) => {
            if (error) {
                window.location.href = "index.html#sign-in";
                return;
            }
            if (!data.user) {
                window.location.href = "index.html#sign-in";
                return;
            }
            if (accountMessage) accountMessage.textContent = `Signed in as ${data.user.email}. Hike history is stored in this browser in this starter version.`;
            if (signOutButton) signOutButton.hidden = false;
        }).catch((error) => {
            if (accountMessage) {
                accountMessage.textContent = `Could not verify your session: ${error.message}`;
            }
        });
    }

    if (signOutButton) {
        signOutButton.addEventListener("click", async () => {
            signOutButton.disabled = true;
            const { error } = await client.auth.signOut();
            if (error) {
                if (accountMessage) accountMessage.textContent = `Could not sign out: ${error.message}`;
                signOutButton.disabled = false;
                return;
            }
            window.location.href = "index.html";
        });
    }
})();
