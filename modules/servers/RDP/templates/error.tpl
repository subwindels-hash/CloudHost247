<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Error - Something Went Wrong</title>
    <style>
        .error-container {
            background: #fff;
            padding: 30px;
            max-width: 500px;
            margin: 50px auto;
            border-radius: 8px;
            box-shadow: 0 4px 10px rgba(0, 0, 0, 0.1);
            text-align: center;
            border-top: 4px solid #e74c3c;
            animation: fadeIn 0.5s ease-in-out;
        }

        h2 {
            color: #e74c3c;
            font-size: 24px;
            margin-bottom: 15px;
        }

        p {
            color: #555;
            font-size: 16px;
            margin-bottom: 10px;
        }

        /* Unique button styling */
        .error-btn {
            display: inline-block;
            margin-top: 15px;
            padding: 10px 20px;
            /* color: #fff;
            background-color: #3498db; */
            text-decoration: none;
            border-radius: 5px;
            transition: 0.3s;
            font-weight: bold;
        }

        .error-btn:hover {
            /* background-color: #2980b9; */
        }

        @keyframes fadeIn {
            from {
                opacity: 0;
                transform: translateY(-10px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }
    </style>
</head>
<body>

    <div class="error-container">
        <h2>Oops! Something went wrong.</h2>
        <p>An unexpected error has occurred. Please go back and try again.</p>
        <p>If the problem persists, please contact our support team for assistance.</p>
        <a href="clientarea.php?action=services" class="btn btn-primary error-btn">Return to Services Page</a>
    </div>

</body>
</html>
