# app.py - Flask Backend
# This file starts the web server and serves the main HTML page.
# No complex logic here - just serving the frontend.

from flask import Flask, render_template

# Create the Flask app
app = Flask(__name__)

# Route for the main page
@app.route('/')
def index():
    # Render and return the index.html template
    return render_template('index.html')

# Start the Flask server
if __name__ == '__main__':
    print("===================================================")
    print("  AI Navigation Assistant for Visually Impaired")
    print("===================================================")
    print("  Server started! Open your browser and go to:")
    print("  http://127.0.0.1:5000")
    print("===================================================")
    app.run(debug=True)
