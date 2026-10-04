    // =====================================================
    // BACKEND
    // =====================================================

    const CHAT_URL =
      "http://localhost:3000/chat";


    // =====================================================
    // ELEMENTS
    // =====================================================

    const chatForm =
      document.getElementById("chatForm");

    const questionInput =
      document.getElementById("questionInput");

    const chatMessages =
      document.getElementById("chatMessages");

    const chatStatus =
      document.getElementById("chatStatus");

    const sendButton =
      document.getElementById("sendButton");


    // =====================================================
    // ADD MESSAGE TO CHAT
    // =====================================================

    function addMessage(
      text,
      sender
    ) {

      const message =
        document.createElement("div");


      message.classList.add(
        "message"
      );


      if (sender === "user") {

        message.classList.add(
          "user-message"
        );

      } else {

        message.classList.add(
          "assistant-message"
        );

      }


      const label =
        document.createElement("div");


      label.classList.add(
        "message-label"
      );


      label.textContent =
        sender === "user"
          ? "You"
          : "Soft Step Assistant";


      const content =
        document.createElement("div");


      content.classList.add(
        "message-content"
      );


      content.textContent =
        text;


      message.appendChild(label);

      message.appendChild(content);

      chatMessages.appendChild(
        message
      );


      // Scroll to newest message
      chatMessages.scrollTop =
        chatMessages.scrollHeight;
    }


    // =====================================================
    // ASK BACKEND
    // =====================================================

    async function askQuestion(
      question
    ) {

      addMessage(
        question,
        "user"
      );


      questionInput.value = "";

      questionInput.disabled = true;

      sendButton.disabled = true;


      chatStatus.textContent =
        "Analyzing hiking data...";


      try {

        // The backend uses this token to answer about
        // the signed-in user's hikes only.
        const {
          data: { session }
        } = await sb.auth.getSession();


        if (!session) {

          addMessage(
            "Please sign in first so I can look at your hikes.",
            "assistant"
          );

          chatStatus.textContent =
            "Not signed in";

          return;
        }


        const response =
          await fetch(
            CHAT_URL,
            {
              method: "POST",

              headers: {
                "Content-Type":
                  "application/json",

                Authorization:
                  `Bearer ${session.access_token}`
              },

              body: JSON.stringify({
                question: question
              })
            }
          );


        const data =
          await response.json();


        if (response.status === 401) {

          addMessage(
            "Your sign-in has expired. Please sign in again so I can look at your hikes.",
            "assistant"
          );

          chatStatus.textContent =
            "Not signed in";

          return;
        }


        if (!response.ok) {

          throw new Error(
            data.error ||
            "Something went wrong"
          );
        }


        addMessage(
          data.answer,
          "assistant"
        );


        chatStatus.textContent = "";

      }

      catch (error) {

        console.error(error);


        addMessage(
          "I couldn't analyze the hiking data. Make sure the backend is running and try again.",
          "assistant"
        );


        chatStatus.textContent =
          "Connection error";

      }

      finally {

        questionInput.disabled =
          false;

        sendButton.disabled =
          false;

        questionInput.focus();

      }
    }


    // =====================================================
    // FORM SUBMIT
    // =====================================================

    chatForm.addEventListener(
      "submit",
      function(event) {

        event.preventDefault();


        const question =
          questionInput
            .value
            .trim();


        if (!question) {
          return;
        }


        askQuestion(
          question
        );

      }
    );


    // =====================================================
    // SUGGESTED QUESTIONS
    // =====================================================

    document
      .querySelectorAll(
        ".suggestion"
      )
      .forEach(button => {

        button.addEventListener(
          "click",
          function() {

            const question =
              button.dataset.question;


            askQuestion(
              question
            );

          }
        );

      });


    // =====================================================
    // ENTER TO SEND
    // SHIFT + ENTER FOR NEW LINE
    // =====================================================

    questionInput.addEventListener(
      "keydown",
      function(event) {

        if (
          event.key === "Enter" &&
          !event.shiftKey
        ) {

          event.preventDefault();

          chatForm.requestSubmit();

        }

      }
    );