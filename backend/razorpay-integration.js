// Razorpay Payment Integration
// Add this script to your mentors.html file

function confirmPayment() {
    console.log('=== RAZORPAY PAYMENT INITIATED ===');
    
    if (!currentPaymentData) {
        alert('Payment data not loaded. Please try again.');
        return;
    }
    
    const { videoId, videoTitle, price, currency } = currentPaymentData;
    const amount = price.toFixed(2);
    
    // Create Razorpay order first
    fetch('/api/create-order', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            amount: parseFloat(amount),
            videoId: videoId,
            videoTitle: videoTitle
        })
    })
    .then(response => response.json())
    .then(orderData => {
        if (orderData.error) {
            alert('Failed to create payment order. Please try again.');
            return;
        }
        
        console.log('Razorpay order created:', orderData);
        
        // Open Razorpay checkout
        const options = {
            key: orderData.keyId,
            amount: orderData.amount,
            currency: orderData.currency,
            name: 'Market Master',
            description: `Payment for ${videoTitle}`,
            order_id: orderData.orderId,
            handler: function (response) {
                console.log('Razorpay payment successful:', response);
                
                // Verify payment on server
                fetch('/api/verify-payment', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        razorpay_order_id: response.razorpay_order_id,
                        razorpay_payment_id: response.razorpay_payment_id,
                        razorpay_signature: response.razorpay_signature,
                        videoId: videoId
                    })
                })
                .then(verifyResponse => verifyResponse.json())
                .then(verifyResult => {
                    if (verifyResult.paid) {
                        alert('Payment successful! Video is now unlocked.');
                        closePaymentModal();
                        fetchVideos(); // Refresh video list
                    } else {
                        alert('Payment verification failed: ' + verifyResult.message);
                    }
                })
                .catch(error => {
                    console.error('Payment verification error:', error);
                    alert('Payment verification failed. Please contact support.');
                });
            },
            modal: {
                ondismiss: function() {
                    console.log('Razorpay modal dismissed');
                }
            }
        };
        
        const rzp = new Razorpay(options);
        rzp.open();
    })
    .catch(error => {
        console.error('Error creating order:', error);
        alert('Failed to create payment order. Please try again.');
    });
}

// Update the payment modal to show Razorpay button instead of QR codes
function updatePaymentModalForRazorpay() {
    // Hide QR code section
    const qrCodeSection = document.getElementById('qrCodeSection');
    if (qrCodeSection) {
        qrCodeSection.style.display = 'none';
    }
    
    // Update payment methods section
    const paymentMethodsSection = document.querySelector('.payment-methods-section');
    if (paymentMethodsSection) {
        paymentMethodsSection.innerHTML = `
            <h4>Complete Your Purchase</h4>
            <div class="razorpay-section">
                <div class="payment-summary">
                    <h3 id="paymentVideoTitle">${currentPaymentData?.videoTitle || 'Video Title'}</h3>
                    <p class="price" id="paymentAmount">$${currentPaymentData?.price || '0.00'}</p>
                </div>
                
                <div class="razorpay-info">
                    <div class="info-box">
                        <i class="fas fa-shield-alt"></i>
                        <div>
                            <h5>Secure Payment</h5>
                            <p>Your payment is secured with Razorpay</p>
                        </div>
                    </div>
                    <div class="info-box">
                        <i class="fas fa-credit-card"></i>
                        <div>
                            <h5>Multiple Payment Options</h5>
                            <p>Credit Card, Debit Card, UPI, NetBanking</p>
                        </div>
                    </div>
                    <div class="info-box">
                        <i class="fas fa-instant"></i>
                        <div>
                            <h5>Instant Access</h5>
                            <p>Get instant access after successful payment</p>
                        </div>
                    </div>
                </div>
                
                <button class="razorpay-pay-btn" onclick="confirmPayment()">
                    <i class="fas fa-lock"></i>
                    Pay Now - Secure Payment
                </button>
            </div>
        `;
    }
}

// Add CSS styles for Razorpay integration
const razorpayStyles = `
<style>
.razorpay-section {
    text-align: center;
    padding: 2rem;
}

.payment-summary {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    padding: 2rem;
    border-radius: 16px;
    margin-bottom: 2rem;
    box-shadow: 0 8px 25px rgba(102, 126, 234, 0.3);
}

.payment-summary h3 {
    margin: 0 0 0.5rem 0;
    font-size: 1.5rem;
    font-weight: 700;
}

.payment-summary .price {
    font-size: 2rem;
    font-weight: 800;
    margin: 0;
    text-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

.razorpay-info {
    display: grid;
    grid-template-columns: 1fr;
    gap: 1rem;
    margin-bottom: 2rem;
}

.info-box {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 1.5rem;
    background: #f8f9fa;
    border-radius: 12px;
    border: 2px solid #e9ecef;
    transition: all 0.3s ease;
}

.info-box:hover {
    border-color: #667eea;
    transform: translateY(-2px);
    box-shadow: 0 8px 25px rgba(102, 126, 234, 0.15);
}

.info-box i {
    font-size: 2rem;
    color: #667eea;
    width: 50px;
    text-align: center;
}

.info-box h5 {
    margin: 0 0 0.5rem 0;
    font-size: 1.1rem;
    font-weight: 600;
    color: #2d3436;
}

.info-box p {
    margin: 0;
    color: #6c757d;
    font-size: 0.9rem;
}

.razorpay-pay-btn {
    background: linear-gradient(135deg, #28a745 0%, #20c997 100%);
    color: white;
    border: none;
    padding: 1.25rem 3rem;
    border-radius: 12px;
    font-size: 1.2rem;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.3s ease;
    display: inline-flex;
    align-items: center;
    gap: 0.75rem;
    box-shadow: 0 8px 25px rgba(40, 167, 69, 0.3);
}

.razorpay-pay-btn:hover {
    transform: translateY(-3px);
    box-shadow: 0 12px 35px rgba(40, 167, 69, 0.4);
}

.razorpay-pay-btn i {
    font-size: 1.1rem;
}
</style>
`;

// Inject styles into the page
document.head.insertAdjacentHTML('beforeend', razorpayStyles);

// Update openPaymentModal to use Razorpay
const originalOpenPaymentModal = window.openPaymentModal;
window.openPaymentModal = function(videoId, videoTitle, price, paymentEmail, paymentUpi, currency) {
    // Call original function to set currentPaymentData
    originalOpenPaymentModal(videoId, videoTitle, price, paymentEmail, paymentUpi, currency);
    
    // Update modal for Razorpay
    setTimeout(() => {
        updatePaymentModalForRazorpay();
    }, 100);
};
