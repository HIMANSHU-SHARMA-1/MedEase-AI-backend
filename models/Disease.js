import mongoose from 'mongoose';

const GlobalStatisticsSchema = new mongoose.Schema(
	{
		globalPrevalence: String, // e.g., "Affects 1 in 10 people worldwide"
		incidenceRate: String, // e.g., "2.5 million new cases per year"
		mortalityRate: String, // e.g., "5% mortality rate"
		affectedRegions: [String], // e.g., ["Asia (45% of cases)", "Africa (5% of cases)"]
		ageGroups: String, // e.g., "Most common in ages 40-60"
		genderDistribution: String, // e.g., "Slightly more common in males"
		economicImpact: String, // e.g., "Costs $X billion annually"
		trends: String, // e.g., "Increasing by 2% per year"
		caseDistribution: String, // e.g., "Top 5 countries: USA (25M), China (18M)..."
		lastUpdated: { type: Date, default: Date.now }
	},
	{ _id: false }
);

const PatientImpactFactsSchema = new mongoose.Schema(
	{
		lifestyleImpact: [String], // e.g., ["May require dietary changes", "Exercise restrictions"]
		workImpact: [String], // e.g., ["May need time off work", "Job modifications"]
		familyImpact: [String], // e.g., ["Genetic counseling recommended", "Family screening advised"]
		financialImpact: [String], // e.g., ["Treatment costs $X per month", "Insurance coverage varies"]
		emotionalImpact: [String], // e.g., ["May cause anxiety", "Support groups available"]
		longTermOutlook: [String], // e.g., ["Good prognosis with treatment", "Requires lifelong monitoring"]
		qualityOfLife: [String], // e.g., ["Minimal impact with proper management", "May affect daily activities"]
		precautions: [String], // e.g., ["Avoid certain medications", "Regular monitoring required"]
		lastUpdated: { type: Date, default: Date.now }
	},
	{ _id: false }
);

const AISummarySchema = new mongoose.Schema(
	{
		cause: String,
		symptoms: [String],
		prevention: [String],
		treatments: [String],
		medications: [String],
		medicationDetails: [
			{
				name: String,
				rxCUI: String,
				brandNames: [String],
				fdaWarnings: [String],
				fdaAdverseReactions: [String],
				fdaIndications: [String],
				drugBank: {
					name: String,
					description: String,
					mechanism: String,
					dosageForms: [String],
					interactions: [mongoose.Schema.Types.Mixed]
				},
				effect: String,
				pharmacyLinks: [
					{
						name: String,
						url: String
					}
				],
				sources: [String]
			}
		],
		emergencyRemedies: [String],
		typicalDuration: String,
		severity: String,
		sources: [String],
		generatedAt: { type: Date, default: Date.now }
	},
	{ _id: false }
);

const AbnormalFindingSchema = new mongoose.Schema(
	{
		test: String,
		value: String,
		unit: String,
		referenceRange: String,
		interpretation: String,
		flag: String,
		severity: String
	},
	{ _id: false }
);

const PharmacyLinkSchema = new mongoose.Schema(
	{
		name: String,
		url: String,
		trusted: { type: Boolean, default: false }
	},
	{ _id: false }
);

const VideoResourceSchema = new mongoose.Schema(
	{
		title: String,
		url: String,
		channel: String,
		duration: String,
		reason: String,
		publishedDate: String, // Publication date
		viewCount: { type: mongoose.Schema.Types.Mixed }, // Can be number or string
		language: { type: String, default: 'en' },
		audioUrl: String,
		audioNarration: String, // Generated narration text for TTS
		audioLanguage: String, // Language of the audio narration
		audioGeneratedAt: Date, // When audio was generated
		refreshedAt: { type: Date, default: Date.now },
		// Web resource fields (when isWebResource is true)
		isWebResource: { type: Boolean, default: false },
		source: String, // Organization/website name for web resources
		description: String, // Description for web resources
		type: String // Resource type: "Article", "Patient Guide", "Fact Sheet", etc.
	},
	{ _id: false }
);

const DiseaseSchema = new mongoose.Schema(
	{
		name: { type: String, required: true, trim: true },
		aiSummary: AISummarySchema,
		globalStatistics: GlobalStatisticsSchema,
		patientImpactFacts: PatientImpactFactsSchema,
		abnormalFindings: [AbnormalFindingSchema],
		videoResources: [VideoResourceSchema],
		specialistProviders: [
			{
				name: String,
				speciality: String,
				hospital: String,
				city: String,
				contact: String,
				mapUrl: String
			}
		],
		pharmacyLinks: [PharmacyLinkSchema],
		approved: { type: Boolean, default: false },
		createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
		aiProvider: { type: String }, // Track which AI provider was used
		aiModel: { type: String } // Track which model was used
	},
	{ timestamps: true }
);

export default mongoose.model('Disease', DiseaseSchema);


