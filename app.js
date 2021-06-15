const express = require("express");
const multer = require("multer");
const app = express();
const { v4: uuidv4 } = require("uuid");
const excelToJson = require("convert-excel-to-json");
const fs = require("fs");
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, __dirname + "/uploads/");
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + "-" + file.originalname);
  },
});
const upload = multer({
  storage: storage,
});
const cors = require("cors");
app.use(express.json());
app.use(cors({ credentials: true, origin: "http://localhost:3000" }));
const mysql = require("mysql");
const { promisedQuery, promisedSelectQuery } = require("./utils");
const connection = mysql.createConnection({
  host: "localhost",
  user: "sammy",
  password: "password123",
  database: "test",
});

const checkConnectivity = (req, res, next) => {
  connection.connect((err) => {
    if (err) {
      res.status(400).json({ error: "Cannot connect to database" });
    } else {
      next();
    }
  });
};

connection.connect(function (err) {
  if (err) {
    console.error("error connecting: " + err.stack);
    return;
  }

  console.log("connected as id " + connection.threadId);

  connection.query(
    `CREATE TABLE IF NOT EXISTS sheet_ids(id int NOT NULL AUTO_INCREMENT PRIMARY KEY, catalog_type varchar(200) NOT NULL, area varchar(200), sheet_name varchar(200) NOT NULL, ad_flag varchar(200), ref varchar(200));`,
    (err) => {
      if (err) {
        console.error("error creating table: " + err.stack);
        return;
      }
    }
  );
  connection.query(
    `CREATE TABLE IF NOT EXISTS sheet_read_count(id varchar(200) PRIMARY KEY, times_allowed_read INT);`,
    (err) => {
      if (err) {
        console.error("error creating table: " + err.stack);
        return;
      }
    }
  );
  connection.query(
    `CREATE TABLE IF NOT EXISTS sheet_data( id INT AUTO_INCREMENT PRIMARY KEY, date varchar(200), type varchar(200) NOT NULL , price varchar(200), sheet_id_ref INT NOT NULL );`,
    (err) => {
      if (err) {
        console.error("error creating table: " + err.stack);
        return;
      }
    }
  );
});

app.use(express.static("build"));

app.get("/get/:id", checkConnectivity, async (req, res) => {
  try {
    let id = req.params.id;
    let sql = `SELECT * FROM sheet_read_count WHERE id = '${id}'`;
    let selectCountQuery = await promisedSelectQuery(connection, sql);
    let availableAttempts = selectCountQuery[0].times_allowed_read;
    if (availableAttempts > 0) {
      sql = `SELECT id, catalog_type AS CatalogType, ad_flag AS Adflag, area AS Area, sheet_name AS Sheet FROM sheet_ids WHERE ref = '${id}';`;
      let data = await promisedSelectQuery(connection, sql);
      let messages = [];
      for (let x of data) {
        sql = `SELECT id, date, type, price FROM sheet_data WHERE sheet_id_ref = '${x.id}';`;
        x.Entries = await promisedSelectQuery(connection, sql);
        delete x.id;
        messages.push(x);
      }

      //   Decrease number of attempts available
      sql = `UPDATE sheet_read_count SET times_allowed_read=${
        availableAttempts - 1
      }  WHERE id = '${req.params.id}'`;
      await promisedSelectQuery(connection, sql);

      return res.send({
        ref: id,
        attempts: availableAttempts - 1,
        success: true,
        messages: messages,
      });
    } else {
      return res.send({
        success: false,
        message: "Maximum downloads exceeded",
      });
    }
  } catch (e) {
    console.log(e);
    return res.send({
      success: false,
      message: "No such file",
    });
  }
});

app.post(
  "/",
  checkConnectivity,
  upload.single("file"),
  async (req, res, next) => {
    const file = req.file;
    let errors = [];

    if (!file) {
      return res.send("Please upload a file");
    }

    const excelInJSON = excelToJson({
      sourceFile: __dirname + "/uploads/" + file.filename,
    });

    let data = [];
    let headerData = {};
    for (let sheet of Object.keys(excelInJSON)) {
      let result = excelInJSON[sheet];
      let firstPart = result.splice(0, 5);
      if (!firstPart[1]["B"]) {
        errors.push(`Catalog type is required on B1`);
      }
      headerData[sheet] = {
        catalog_type: firstPart[1]?.["B"],
        area: firstPart[0]?.["B"],
        ad_flag: firstPart[2]?.["B"],
      };
      if (!errors.length) {
        result.map((c, i) => {
          let date = undefined;
          if (c["A"]) {
            date = c["A"];
            delete c["A"];
          }
          Object.keys(c).map((d, i) => {
            let type = firstPart[4][d];
            let price = c[d];
            if (price && isNaN(price)) {
              errors.push(`${price} is not a number on line ${d} ${i + 5}`);
            }
            data.push({
              date,
              type,
              price,
              sheet_name: sheet,
            });
          });
        });
      }
    }
    if (errors.length) {
      return res.send({
        success: false,
        message: errors,
      });
    }

    try {
      let id = uuidv4();
      let sql = "INSERT INTO sheet_read_count SET ?";
      await promisedQuery(connection, sql, {
        id,
        times_allowed_read: 5,
      });
      for (let sheet of Object.keys(excelInJSON)) {
        let sql = "INSERT INTO sheet_ids SET ?";
        let response = await promisedQuery(connection, sql, {
          ...headerData[sheet],
          ref: id,
          sheet_name: sheet,
        });
        console.log("added ", sheet);
        let insertData =
          "INSERT INTO sheet_data (date, type, price ,sheet_id_ref) VALUES ?";
        var values = data
          .filter((el) => el.sheet_name == sheet)
          .map((el) => ({
            date: el.date,
            type: el.type,
            price: el.price,
          }))
          .map((c) => [...Object.values(c), response[0].insertId]);
        await promisedQuery(connection, insertData, [values]);
      }
      res.send({
        success: true,
        message: "Data added successfully.",
        id: id,
      });
      fs.unlinkSync(__dirname + "/uploads/" + file.filename);
    } catch (e) {
      console.log(e);
      return res.send({
        success: false,
        message: "Failed to add data to database",
      });
    }
  }
);

app.listen(process.env.PORT || 5000, () => {
  console.log("listening on ", process.env.PORT || 5000);
});
