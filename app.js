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
app.use(cors());
const mysql = require("mysql");
const connection = mysql.createConnection({
    host: "sql7.freemysqlhosting.net",
    user: "sql7361610",
    password: "ewRUUjNWEy",
    database: "sql7361610",
});

connection.connect(function (err) {
    if (err) {
        console.error("error connecting: " + err.stack);
        return;
    }

    console.log("connected as id " + connection.threadId);

    connection.query(
        `CREATE TABLE IF NOT EXISTS sheet_ids(id varchar(36) PRIMARY KEY, catalog_type varchar(200) NOT NULL, area varchar(200) , times_allowed_read int);`,
        (err) => {
            if (err) {
                console.error("error creating table: " + err.stack);
                return;
            }
        }
    );
    connection.query(
        `CREATE TABLE IF NOT EXISTS sheet_data( id INT AUTO_INCREMENT PRIMARY KEY, date varchar(200), type varchar(200) NOT NULL , price varchar(200), ref varchar(36) );`,
        (err) => {
            if (err) {
                console.error("error creating table: " + err.stack);
                return;
            }
        }
    );
});

app.use(express.static("build"));

app.get("/get/:id", (req, res) => {
    let sql = `SELECT * FROM sheet_ids WHERE id = '${req.params.id}'`;
    console.log(sql);
    console.log(req.params);
    connection.query(sql, (err, data) => {
        if (err) console.log(err);
        else {
            if (data.length > 0) {
                if (data[0].times_allowed_read > 0) {
                    let sql = `SELECT * FROM sheet_data WHERE ref = '${req.params.id}'`;
                    connection.query(sql, (err, data) => {
                        if (err) console.log(err);
                        res.send({
                            success: true,
                            message: data,
                        });
                    });
                    sql = `UPDATE sheet_ids SET times_allowed_read=${
                        data[0].times_allowed_read - 1
                    }  WHERE id = '${req.params.id}'`;
                    connection.query(sql, (err) => {
                        if (err) console.log(err);
                        console.log("Decreased allowed times to read");
                    });
                } else {
                    res.send({
                        success: false,
                        message: "Maximum downloads exceeded",
                    });
                }
            } else {
                res.send({
                    success: false,
                    message: "No such file",
                });
            }
        }
    });
});

app.post("/", upload.single("file"), (req, res, next) => {
    const file = req.file;
    if (!file) {
        return res.send("Please upload a file");
    }
    const result = excelToJson({
        sourceFile: __dirname + "/uploads/" + file.filename,
    }).Sheet1;
    let firstPart = result.splice(0, 4);
    if (!firstPart[0]["B"]) {
        errors.push(`Catalog type is required on B1`);
    }
    let area = firstPart[1]["B"];
    let data = [];
    let errors = [];
    if (!errors.length) {
        result.map((c, i) => {
            let date = undefined;
            if (c["A"]) {
                date = c["A"];
                delete c["A"];
            }
            Object.keys(c).map((d, i) => {
                let type = firstPart[3][d];
                let price = c[d];
                if (price && isNaN(price)) {
                    errors.push(
                        `${price} is not a number on line ${d} ${i + 4}`
                    );
                }
                data.push({
                    date,
                    type,
                    price,
                });
            });
        });
    }
    if (errors.length) {
        return res.send({
            success: false,
            message: errors,
        });
    }
    let id = "";
    if (!errors.length) {
        id = uuidv4();
        var sql =
            "INSERT INTO sheet_ids (id, catalog_type, area,  times_allowed_read) VALUES ?";
        var values = [[id, firstPart[0]["B"], firstPart[1]["B"], 5]];
        connection.query(sql, [values], function (err) {
            if (err) {
                console.log(err);
                return res.send({
                    success: false,
                    message: "Failed to add data to database",
                });
            }
            var sql =
                "INSERT INTO sheet_data (date, type, price ,ref) VALUES ?";
            var values = data.map((c) => [...Object.values(c), id]);
            connection.query(sql, [values], function (err) {
                if (err) {
                    console.log(err);
                    return res.send({
                        success: false,
                        message: "Failed to add data to database",
                    });
                }
                return res.send({
                    success: true,
                    message: "Data added successfully.",
                    id: id,
                });
            });
        });
    }

    try {
        fs.unlinkSync(__dirname + "/uploads/" + file.filename);
    } catch (err) {
        console.error(err);
    }
});

app.listen(process.env.PORT || 5000, () => {
    console.log("listening on ", process.env.PORT || 5000);
});
