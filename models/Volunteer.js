const mongoose = require('mongoose');

const volunteerSchema = new mongoose.Schema({
  fullName: { type: String, required: true, trim: true },
  mssv: { type: String, required: true, trim: true, uppercase: true },
  status: { type: String, enum: ['pending', 'approved'], default: 'pending' },
  activities: [{
    content: { type: String, required: true },
    date: { type: String, required: true },
    status: { type: String, enum: ['pending', 'approved'], default: 'approved' }
  }],
  faults: [{
    fault: { type: String, required: true },
    date: { type: String, required: true }
  }],
  campaigns: [{
    campaignName: { type: String, required: true },
    achievement: { type: String, default: '' }
  }],
  notes: [{
    text: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
  }],
  generalNote: { type: String, default: '' }
}, { timestamps: true });

volunteerSchema.index({ mssv: 1, fullName: 1 }, { unique: true });

module.exports = mongoose.model('Volunteer', volunteerSchema);
