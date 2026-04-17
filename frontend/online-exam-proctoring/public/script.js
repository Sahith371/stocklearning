document.addEventListener('DOMContentLoaded', () => {
    const startExamBtn = document.getElementById('startExamBtn');

    startExamBtn.addEventListener('click', () => {
        alert('Exam started! Please ensure you are in a quiet, well-lit environment.');
        console.log('Exam session started');
        // Add exam proctoring logic here
    });

    console.log('Online Exam Proctoring System loaded');
});

// Add more JavaScript functionality as needed
