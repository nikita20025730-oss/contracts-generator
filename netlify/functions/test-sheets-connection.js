const { readBudgetSheet } = require("../../google_integration/sheets_reader");

exports.handler = async function () {
  try {
    const items = await readBudgetSheet(
      "12mWcTV1mErWe283Cwy3kOdwD2qtTiuB3fM5oBXGzrE0",
      "ТОЧКА"
    );
    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, rowCount: items.length, firstRow: items[0] }, null, 2),
    };
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ success: false, error: error.message }) };
  }
};
