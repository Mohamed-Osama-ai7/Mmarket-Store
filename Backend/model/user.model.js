const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

const userSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: [true, "Name is required"],
            trim: true,
            minlength: [2, "Name must be at least 2 characters"],
            maxlength: [100, "Name cannot exceed 100 characters"]
        },

        email: {
            type: String,
            required: [true, "Email is required"],
            unique: true,
            trim: true,
            lowercase: true,
            maxlength: 254,
            match: [
                /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                "Please enter a valid email address"
            ]
        },

        phone: {
            type: String,
            trim: true,
            maxlength: 24,
            default: "",
            validate: { validator: value => !value || /^[+()0-9 .-]{7,24}$/.test(value), message: "Please enter a valid phone number" }
        },

        address: {
            type: String,
            trim: true,
            maxlength: 300,
            default: ""
        },

        mergedGuestCartKeys: {
            type: [String],
            default: [],
            select: false
        },

        password: {
            type: String,
            required: [true, "Password is required"],
            minlength: [8, "Password must have a JavaScript string length of at least 8"],
            validate: {
                validator: value =>
                    typeof value === "string" &&
                    Buffer.byteLength(value, "utf8") <= 72,
                message: "Password must be no more than 72 bytes when encoded as UTF-8"
            }
        },

        role: {
            type: String,
            enum: ["user", "admin"],
            default: "user"
        },

        // Incremented on logout/password change to invalidate existing access tokens.
        tokenVersion: {
            type: Number,
            default: 0,
            min: 0
        },

        isActive: {
            type: Boolean,
            default: true
        },

        // Only a hash of the one-time reset token is stored in MongoDB.
        resetPasswordTokenHash: {
            type: String,
            default: null,
            select: false
        },
        resetPasswordExpires: {
            type: Date,
            default: null,
            select: false
        }
    },
    {
        timestamps: true
    }
);


// Hash the password before saving
userSchema.pre("save", async function () {
    if (!this.isModified("password")) {
        return;
    }

    this.password = await bcrypt.hash(this.password, 12);
});


// Compare the entered password with the hashed password
userSchema.methods.isCorrectPassword = async function (
    inputPassword
) {
    return bcrypt.compare(inputPassword, this.password);
};


const User = mongoose.model("User", userSchema);

module.exports = User;