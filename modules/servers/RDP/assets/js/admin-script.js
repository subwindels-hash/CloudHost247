document.addEventListener("DOMContentLoaded", function () {
    let isPasswordVisible = false;
    
    const passwordField = document.getElementById("passwordField");
    const eyeIcon = document.getElementById("eyeIcon");
    const toggleButton = document.getElementById("togglePassword");

    toggleButton.addEventListener("click", function() {
        if (isPasswordVisible) {
            passwordField.textContent = ".................";
            eyeIcon.classList.remove("fa-eye-slash");
            eyeIcon.classList.add("fa-eye");
        } else {
            const encodedPassword = toggleButton.getAttribute("data-password");
            const decodedPassword = atob(encodedPassword); // Decode Base64
            passwordField.textContent = decodedPassword;
            eyeIcon.classList.remove("fa-eye");
            eyeIcon.classList.add("fa-eye-slash");
        }
        isPasswordVisible = !isPasswordVisible;
    });
});